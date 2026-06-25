# My Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/app/settings` in the design language as a 3×2 nav-palette matrix over six focused sub-pages (plus a per-provider page), consuming the picker primitives already shipped on `feat/picker-components`.

**Architecture:** Mirror the shipped My Account slice exactly — each surface is a `PageScaffold` page (sticky breadcrumb + `?`-help) reached via `NavTile`s by route string; text fields use the always-save model (persist on blur), pickers stage-and-Save. Two tiny new primitives (`InlineEditTextarea`, `ModelSlotPicker`) plus seven page components plus help docs; the old single-page accordion and the `ProviderSheet` overlay are removed.

**Tech Stack:** React 18 + react-router-dom, TypeScript strict, Vitest + Testing Library, Tailwind v4, existing `@chatsundere/llm-unified` + `@chatsundere/ui-shared` packages, TanStack Query data hooks.

## Global Constraints

- **British English** in every artefact — code, comments, copy, log strings (CLAUDE.md §3/§7).
- **No Dexie bump, no schema change.** Every page reads/writes existing `SettingsRow`/`ProviderRow` shapes via `useSettings`/`useUpdateSettings`/`useProviders`/`useMindspaces`/`useUpsertProvider`/`useDeleteProvider`.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`; no `any` without an inline reason. Biome bans the non-null `!` assertion.
- **Disabled over hidden** (CLAUDE.md §11): unavailable capabilities render disabled-with-reason (focusable, announced), never removed.
- **Always-save, no SaveBar** on the rebuilt surface (My Account precedent). Network probes (provider key test) are the one explicit-action exception.
- **Labels are final** (Chris-approved): `You`, `AI Providers`, `Web Access`, `Voice`, `Images`, `"Ask an Expert"` (the quotes are part of the label).
- **Gate per task:** `pnpm --filter @chatsundere/user-client test` (full user-client vitest, expect the **8 Node-localStorage baseline** failures only) **and** `pnpm typecheck --force` (Turbo caches typecheck — force it). Never trust a touched-dir-only run.
- **Commit** at the end of each task; British-English imperative subject; `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Do not push or switch branches.
- Spec: `superpowers/specs/2026-06-25-my-settings-design.md`. Picker spec: `superpowers/specs/2026-06-23-picker-components-design.md`.

---

## File Structure

**New files:**
- `apps/user-client/src/routes/app/settings/InlineEditTextarea.tsx` — always-save multi-line text row (Task 1).
- `apps/user-client/src/components/ModelSlotPicker.tsx` — PickerField + ModelPickerOverlay + open-state, with optional clear (Task 2).
- `apps/user-client/src/content/help/settings*.md` ×7 + entries in `content/help/index.ts` (Task 3).
- `apps/user-client/src/routes/app/settings/you.tsx` (Task 4).
- `apps/user-client/src/routes/app/settings/providers.tsx` (Task 5).
- `apps/user-client/src/routes/app/settings/provider.tsx` — per-provider, `:templateId` (Task 6).
- `apps/user-client/src/routes/app/settings/web.tsx` (Task 7).
- `apps/user-client/src/routes/app/settings/voice.tsx` (Task 8).
- `apps/user-client/src/routes/app/settings/images.tsx` (Task 9).
- `apps/user-client/src/routes/app/settings/expert.tsx` (Task 10).
- Tests under `apps/user-client/tests/component/` mirroring each.

**Modified:**
- `apps/user-client/src/routes/app/settings.tsx` — rewritten wholesale into the root matrix (Task 11). Keeps `export function Settings`.
- `apps/user-client/src/App.tsx` — register the seven new routes (Task 12).
- `apps/user-client/src/content/help/index.ts` — new `HelpKey`s (Task 3).

**Removed (Task 12):**
- `apps/user-client/src/components/ProviderSheet.tsx` (superseded by `provider.tsx`).

---

### Task 1: `InlineEditTextarea` primitive

The multi-line sibling of `InlineEditRow` (`routes/app/account/InlineEditRow.tsx`). Commits on **blur only** (Enter inserts a newline in a textarea), reuses the same de-dupe + external-resync discipline, and shows the `Saved ✓` polite live region.

**Files:**
- Create: `apps/user-client/src/routes/app/settings/InlineEditTextarea.tsx`
- Test: `apps/user-client/tests/component/settings-inline-edit-textarea.test.tsx`

**Interfaces:**
- Produces: `InlineEditTextarea({ label, value, placeholder?, helper?, minRows?, onSave }): JSX.Element` where `onSave: (next: string) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/settings-inline-edit-textarea.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineEditTextarea } from '../../src/routes/app/settings/InlineEditTextarea.js';

describe('InlineEditTextarea', () => {
  it('persists the edited value on blur and announces Saved', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditTextarea label="About me" value="old" onSave={onSave} />);
    const field = screen.getByLabelText('About me');
    fireEvent.change(field, { target: { value: 'new text' } });
    fireEvent.blur(field);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('new text'));
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
  });

  it('does not persist when the value is unchanged (no-op guard)', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditTextarea label="About me" value="same" onSave={onSave} />);
    fireEvent.blur(screen.getByLabelText('About me'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Enter inserts a newline and does not commit', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditTextarea label="About me" value="" onSave={onSave} />);
    const field = screen.getByLabelText('About me');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-inline-edit-textarea`
Expected: FAIL — module not found / `InlineEditTextarea` is not exported.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/user-client/src/routes/app/settings/InlineEditTextarea.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, useState } from 'react';

export interface InlineEditTextareaProps {
  label: string;
  value: string;
  placeholder?: string;
  /** Sub-label helper copy under the field. */
  helper?: string;
  minRows?: number;
  /** Persist the new value; throw to signal a failed save (value + focus kept). */
  onSave: (next: string) => Promise<void>;
}

/**
 * Multi-line always-save field (spec §3): persists on blur (Enter inserts a
 * newline, so blur is the commit), with a transient polite-live-region
 * "Saved ✓". Mirrors `InlineEditRow`'s de-dupe and external-resync discipline.
 * Leaving the page blurs the field first, so the dispatched save survives
 * unmount (spec §3 blur-flush, Laura SOFT-4).
 */
export function InlineEditTextarea({
  label,
  value,
  placeholder,
  helper,
  minRows = 4,
  onSave,
}: InlineEditTextareaProps): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const focusedRef = useRef(false);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Re-sync the draft on external change, but never while the user is editing.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commit = async (): Promise<void> => {
    if (savingRef.current) return;
    if (draft === valueRef.current) return;
    savingRef.current = true;
    setError(null);
    try {
      await onSave(draft);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs uppercase tracking-wider text-paper-soft">
        {label}
      </label>
      <textarea
        id={id}
        aria-label={label}
        rows={minRows}
        className="resize-y rounded-lg border border-paper-soft/15 bg-white/5 px-3 py-2 text-paper"
        value={draft}
        placeholder={placeholder}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          void commit();
        }}
      />
      {helper ? <p className="text-[11px] text-paper-soft">{helper}</p> : null}
      <div aria-live="polite" className="min-h-[1rem] text-xs">
        {error ? <span style={{ color: 'var(--color-destructive-text)' }}>{error}</span> : null}
        {saved ? <span style={{ color: 'var(--color-nav-green-icon)' }}>Saved ✓</span> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-inline-edit-textarea`
Expected: PASS (3 tests).

- [ ] **Step 5: Gate + commit**

Run: `pnpm --filter @chatsundere/user-client test` (8-failure baseline) and `pnpm typecheck --force`.

```bash
git add apps/user-client/src/routes/app/settings/InlineEditTextarea.tsx apps/user-client/tests/component/settings-inline-edit-textarea.test.tsx
git commit -m "Add InlineEditTextarea always-save multi-line row"
```

---

### Task 2: `ModelSlotPicker` composed wrapper

Bundles `PickerField` + `ModelPickerOverlay` + open-state so the two chat/vision model-pick sites (substitute-vision, expert-model) share one tested unit. Optional clear control (set → "Use none") because both slots are legitimately "None".

**Files:**
- Create: `apps/user-client/src/components/ModelSlotPicker.tsx`
- Test: `apps/user-client/tests/component/model-slot-picker.test.tsx`

**Interfaces:**
- Consumes: `ModelPickerOverlay` (`components/ModelPickerOverlay.js`), `PickerField` (`components/ui/PickerField.js`), `ModelFilter`/`ModelSelection` (`components/model-picker/model-picker-data.js`), `ProviderRow`.
- Produces:
```ts
interface ModelSlotPickerProps {
  label: string;
  /** What the field shows when a model is set (e.g. its display name). */
  valueLabel: React.ReactNode;
  /** Shown (muted) when nothing is set. */
  emptyLabel: string;
  filter?: 'all' | 'vision';
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  current: { providerTemplateId: string; upstreamSlug: string } | null;
  onSelect: (sel: ModelSelection) => void;
  onClear?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  stale?: { reason: React.ReactNode };
}
```

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/model-slot-picker.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelSlotPicker } from '../../src/components/ModelSlotPicker.js';

const baseProps = {
  label: 'Expert model',
  valueLabel: 'GLM-4.7',
  emptyLabel: 'None — pick a model',
  providers: [],
  configuredTemplateIds: [],
};

describe('ModelSlotPicker', () => {
  it('shows the empty label and opens the overlay on tap', () => {
    render(<ModelSlotPicker {...baseProps} current={null} onSelect={vi.fn()} />);
    expect(screen.getByText('None — pick a model')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Expert model/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders a clear control when set and onClear is given', () => {
    const onClear = vi.fn();
    render(
      <ModelSlotPicker
        {...baseProps}
        current={{ providerTemplateId: 'chutes', upstreamSlug: 'glm' }}
        onSelect={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /use none/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('does not open when disabled', () => {
    render(
      <ModelSlotPicker
        {...baseProps}
        current={null}
        disabled
        disabledReason="Add a provider first"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Expert model/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test model-slot-picker`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/user-client/src/components/ModelSlotPicker.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import type { ProviderRow } from '../boot/client-data-db.js';
import { ModelPickerOverlay } from './ModelPickerOverlay.js';
import type { ModelFilter, ModelSelection } from './model-picker/model-picker-data.js';
import { PickerField } from './ui/PickerField.js';

export interface ModelSlotPickerProps {
  label: string;
  valueLabel: React.ReactNode;
  emptyLabel: string;
  filter?: ModelFilter;
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  current: { providerTemplateId: string; upstreamSlug: string } | null;
  onSelect: (sel: ModelSelection) => void;
  onClear?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  stale?: { reason: React.ReactNode };
}

/**
 * One model slot: a PickerField trigger that opens the two-step
 * `ModelPickerOverlay` (spec §7/§8). When a model is set and `onClear` is given,
 * a quiet "Use none" control turns the slot off (disabled-over-hidden — the
 * capability stays visible). The vision filter is call-site-locked.
 */
export function ModelSlotPicker({
  label,
  valueLabel,
  emptyLabel,
  filter = 'all',
  providers,
  configuredTemplateIds,
  current,
  onSelect,
  onClear,
  disabled,
  disabledReason,
  stale,
}: ModelSlotPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <PickerField
        label={label}
        value={current ? valueLabel : <span className="text-paper-soft">{emptyLabel}</span>}
        stale={stale}
        disabled={disabled}
        disabledReason={disabledReason}
        onOpen={(el) => {
          triggerRef.current = el;
          setOpen(true);
        }}
      />
      {current && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="self-start text-[11px] text-paper-soft underline hover:text-paper"
        >
          Use none
        </button>
      ) : null}
      <ModelPickerOverlay
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(sel) => {
          onSelect(sel);
          setOpen(false);
        }}
        providers={providers}
        configuredTemplateIds={configuredTemplateIds}
        filter={filter}
        current={current}
        triggerRef={triggerRef}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test model-slot-picker`
Expected: PASS (3 tests).

- [ ] **Step 5: Gate + commit**

```bash
git add apps/user-client/src/components/ModelSlotPicker.tsx apps/user-client/tests/component/model-slot-picker.test.tsx
git commit -m "Add ModelSlotPicker composing PickerField and ModelPickerOverlay"
```

---

### Task 3: Help docs for the seven settings surfaces

Add one short Markdown help doc per page + the `HelpKey`s, so every page can call `useHelp('settings-*')`. Copy is British-English, calm, plain-language (ND audience). The **You** doc draws the identity-seam line (Laura SOFT-1).

**Files:**
- Create: `apps/user-client/src/content/help/settings.md`, `settings-you.md`, `settings-providers.md`, `settings-web.md`, `settings-voice.md`, `settings-images.md`, `settings-expert.md`
- Modify: `apps/user-client/src/content/help/index.ts`
- Test: `apps/user-client/tests/component/help-docs-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/component/help-docs-settings.test.ts
import { describe, expect, it } from 'vitest';
import { HELP_DOCS } from '../../src/content/help/index.js';

describe('settings help docs', () => {
  const keys = [
    'settings',
    'settings-you',
    'settings-providers',
    'settings-web',
    'settings-voice',
    'settings-images',
    'settings-expert',
  ] as const;
  it('registers every settings help key with non-empty markdown', () => {
    for (const k of keys) {
      expect(HELP_DOCS[k]?.markdown.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test help-docs-settings`
Expected: FAIL — keys not present in `HELP_DOCS` (and TS error on the indexing).

- [ ] **Step 3: Create the seven Markdown docs**

`settings.md`:
```markdown
# My Settings

Everything that shapes how your Circle works, grouped into six rooms.

- **You** — what the AI knows about you, your global instructions, your mindspace.
- **AI Providers** — the services that power your companions, and their keys.
- **Web Access** — let companions search and fetch from the internet.
- **Voice** — read-aloud and dictation.
- **Images** — reading images your companions are shown, and creating new ones.
- **"Ask an Expert"** — let a companion delegate a hard question to a stronger model.

A greyed-out room tells you what it needs before it can be used.
```

`settings-you.md` (draws the identity seam — Laura SOFT-1):
```markdown
# You

This is what the AI *knows* about you — the context your companions carry into
every chat. It is different from **My Account**, which is who you are to the
system (your username and how you sign in).

- **About Me** — a short description of you, woven into every persona's prompt
  unless a persona overrides it.
- **Global Instructions** — your own standing wishes, added to every persona.
- **Mindspace** — your visual identity: the look a companion sees as "you".

Changes save themselves the moment you leave a field.
```

`settings-providers.md`:
```markdown
# AI Providers

Providers are the services that actually run your companions' models. Add one by
giving it an API key; Chatsundere tests the key, then the provider lights up.

The **CORS proxy** here is shared by every provider that needs it — set it once.

Tap a provider to manage its key or remove it. Removing a key disconnects any
persona that was using it.
```

`settings-web.md`:
```markdown
# Web Access

Let your companions search the web and fetch pages. Choose a **search** backend
and a **fetch** backend — or set either to **Off**.

If this room is greyed out, none of your providers offers web access yet — add a
web-capable provider under **AI Providers**.
```

`settings-voice.md`:
```markdown
# Voice

How your companions speak and listen.

- **Read-aloud** — the voice and how much is spoken at once.
- **Cleanup** — a gentle high-pass filter for clearer playback.
- **Dictation** — speak instead of type.

Each control explains itself when it is unavailable.
```

`settings-images.md`:
```markdown
# Images

Two directions, one room.

- **Reading images** — when your companion's model can't see pictures on its own,
  this model reads them for it.
- **Creating images** — the model your companions paint with. A separate slot
  lights up for an explicit-capable model once one is available.

Both choices are global and apply to every persona.
```

`settings-expert.md`:
```markdown
# "Ask an Expert"

When a companion meets a hard question, it can quietly hand it to a stronger
model and bring back the answer.

- **Expert model** — the stronger model to delegate to.
- **Expert web** — let that expert search and fetch too.

Only the sanitised question leaves your device — never your conversation,
persona, or personal details.
```

- [ ] **Step 4: Register the keys in `index.ts`**

Add the imports and union members + map entries to `apps/user-client/src/content/help/index.ts`:

```ts
import settings from './settings.md?raw';
import settingsExpert from './settings-expert.md?raw';
import settingsImages from './settings-images.md?raw';
import settingsProviders from './settings-providers.md?raw';
import settingsVoice from './settings-voice.md?raw';
import settingsWeb from './settings-web.md?raw';
import settingsYou from './settings-you.md?raw';
```

Extend `HelpKey` with: `'settings' | 'settings-you' | 'settings-providers' | 'settings-web' | 'settings-voice' | 'settings-images' | 'settings-expert'`.

Add to `HELP_DOCS`:
```ts
  settings: { title: 'My Settings — help', markdown: settings },
  'settings-you': { title: 'You — help', markdown: settingsYou },
  'settings-providers': { title: 'AI Providers — help', markdown: settingsProviders },
  'settings-web': { title: 'Web Access — help', markdown: settingsWeb },
  'settings-voice': { title: 'Voice — help', markdown: settingsVoice },
  'settings-images': { title: 'Images — help', markdown: settingsImages },
  'settings-expert': { title: '"Ask an Expert" — help', markdown: settingsExpert },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test help-docs-settings`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

```bash
git add apps/user-client/src/content/help/settings*.md apps/user-client/src/content/help/index.ts apps/user-client/tests/component/help-docs-settings.test.ts
git commit -m "Add help docs for the six My Settings surfaces"
```

---

### Task 4: **You** sub-page

**Files:**
- Create: `apps/user-client/src/routes/app/settings/you.tsx`
- Test: `apps/user-client/tests/component/settings-you.test.tsx`

**Interfaces:**
- Consumes: `InlineEditTextarea` (Task 1), `MindspacePickerOverlay`, `PickerField`, `PageScaffold`, `useHelp('settings-you')`, `useSettings`/`useUpdateSettings`, `useMindspaces`.
- Produces: `export function SettingsYouPage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/settings-you.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsYouPage } from '../../src/routes/app/settings/you.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsYouPage', () => {
  it('renders About Me, Global Instructions and a Mindspace trigger', async () => {
    wrap(<SettingsYouPage />);
    expect(await screen.findByLabelText('About me')).toBeInTheDocument();
    expect(screen.getByLabelText('Global instructions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mindspace/i })).toBeInTheDocument();
  });
});
```

> Note: `useSettings`/`useMindspaces` read from the local DB through TanStack Query. If the suite needs a seeded DB, follow the existing pattern used by `tests/component/*` that touch `useSettings` (search for a sibling test that renders a settings-dependent component and copy its DB-seed/mocks helper). The assertion above only needs the fields to render after load; gate the body on a `Loading…` guard like `settings.tsx:366`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-you`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

```tsx
// apps/user-client/src/routes/app/settings/you.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { PickerField } from '../../../components/ui/PickerField.js';
import {
  MindspacePickerOverlay,
  type MindspaceSelection,
} from '../../../components/MindspacePickerOverlay.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useMindspaces } from '../../../data/mindspaces.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { InlineEditTextarea } from './InlineEditTextarea.js';

/** My Settings › You — AI-facing identity: about-me, global instructions, mindspace. */
export function SettingsYouPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-you');
  const settings = useSettings();
  const update = useUpdateSettings();
  const mindspaces = useMindspaces();
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const body = (() => {
    if (!settings.data || !mindspaces.data) {
      return <div className="p-4 text-paper-soft">Loading…</div>;
    }
    const s = settings.data;
    const selected = mindspaces.data.find((m) => m.id === s.defaultMindspaceId);
    const initial: MindspaceSelection = {
      mindspaceId: s.defaultMindspaceId,
      texture: s.userTexture,
      font: 'sans',
    };
    return (
      <div className="flex flex-col gap-6 px-4 pb-8 pt-2">
        <InlineEditTextarea
          label="About me"
          value={s.globalAboutMe}
          placeholder="Tell your Circle who you are…"
          helper="Included in every persona's system prompt unless overridden per-persona."
          onSave={(v) => update.mutateAsync({ globalAboutMe: v })}
        />
        <InlineEditTextarea
          label="Global instructions"
          value={s.globalInstructions}
          helper="Added to every persona's system prompt — always global, no per-persona override."
          onSave={(v) => update.mutateAsync({ globalInstructions: v })}
        />
        <div className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wider text-paper-soft">Mindspace</div>
          <PickerField
            label="Mindspace"
            value={selected?.name ?? 'Default'}
            onOpen={(el) => {
              triggerRef.current = el;
              setPickerOpen(true);
            }}
          />
        </div>
        <MindspacePickerOverlay
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          triggerRef={triggerRef}
          mindspaces={mindspaces.data}
          previewName={s.displayName?.trim() || 'You'}
          initial={initial}
          hideFont
          onSave={(next) => {
            void update.mutateAsync({
              defaultMindspaceId: next.mindspaceId ?? s.defaultMindspaceId,
              userTexture: next.texture,
            });
            setPickerOpen(false);
          }}
        />
      </div>
    );
  })();

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'You' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      {body}
    </PageScaffold>
  );
}
```

> Verify against the live `MindspaceRow` type whether the display field is `name` (the picker uses `selectedMindspaceId`); if the property differs, use the correct one — do not invent it. The `font` is `hideFont`, so `'sans'` is an inert seed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-you`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
git add apps/user-client/src/routes/app/settings/you.tsx apps/user-client/tests/component/settings-you.test.tsx
git commit -m "Add My Settings › You sub-page"
```

---

### Task 5: **AI Providers** overview sub-page

Port the existing `ProvidersSection` (`settings.tsx:146-244`) verbatim into a `PageScaffold` page, with one change: tapping a provider row or picking a new provider **navigates** to `/app/settings/providers/:templateId` instead of opening `ProviderSheet`.

**Files:**
- Create: `apps/user-client/src/routes/app/settings/providers.tsx`
- Test: `apps/user-client/tests/component/settings-providers.test.tsx`

**Interfaces:**
- Consumes: `CorsProxyBlock`, `CapBadgeRow`, `AddProviderPicker`, `useProviders`, `useSettings`, `usableTemplateIds`, `aggregateServiceKinds`, `providerServiceKinds`, `getProvider`, `providersContributing`, `BUILT_IN_PROVIDERS`, `PageScaffold`, `useHelp('settings-providers')`, `useNavigate`.
- Produces: `export function SettingsProvidersPage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/settings-providers.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsProvidersPage } from '../../src/routes/app/settings/providers.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsProvidersPage', () => {
  it('shows the empty-Circle copy and an add-provider control when no providers', async () => {
    wrap(<SettingsProvidersPage />);
    expect(await screen.findByText(/add a provider to begin/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add provider/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-providers`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

Lift the body of `ProvidersSection` (`settings.tsx:146-244`) into this page. Concrete transform:
1. Wrap the returned `<div className="flex flex-col gap-3">…</div>` in `PageScaffold` (crumbs `My Settings › AI Providers`, `back="/app/settings"`, `onHelp`), with `{helpOverlay}` first.
2. Add `const navigate = useNavigate();`. Remove the `openSheet` state and the `<ProviderSheet …>` render entirely.
3. The provider row `onClick={() => setOpenSheet(...)}` becomes `onClick={() => navigate(\`/app/settings/providers/${row.templateId}\`)}`.
4. `AddProviderPicker`'s `onPick={(id) => { setPicking(false); navigate(\`/app/settings/providers/${id}\`); }}`; keep `onNeedProxy={() => setPicking(false)}` and `onClose={() => setPicking(false)}`.
5. Keep the `CorsProxyBlock`, the "What you have" `CapBadgeRow` + `tooltipFor`, the `statusOf` helper, the row list, and the `+ Add provider` button verbatim.

```tsx
// apps/user-client/src/routes/app/settings/providers.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import {
  type ServiceKind,
  aggregateServiceKinds,
  getProvider,
  providerServiceKinds,
  providersContributing,
} from '@chatsundere/llm-unified';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AddProviderPicker } from '../../../components/AddProviderPicker.js';
import { CapBadgeRow } from '../../../components/CapBadgeRow.js';
import { CorsProxyBlock } from '../../../components/CorsProxyBlock.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useProviders } from '../../../data/providers.js';
import { useSettings } from '../../../data/settings.js';
import { BUILT_IN_PROVIDERS, type ProviderTemplateId } from '../../../lib/built-in-providers.js';
import { usableTemplateIds } from '../../../lib/usable-providers.js';

/** My Settings › AI Providers — proxy, capability summary, provider list, add. */
export function SettingsProvidersPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-providers');
  const navigate = useNavigate();
  const providers = useProviders();
  const settings = useSettings();
  const [picking, setPicking] = useState(false);

  const rows = providers.data ?? [];
  const hasProxy = !!settings.data?.corsProxy;
  const usable = usableTemplateIds(rows, hasProxy);
  const lit = aggregateServiceKinds(usable);

  const tooltipFor = (k: ServiceKind): string => {
    const contributors = providersContributing(k).filter(
      (id) => !rows.some((r) => r.templateId === id),
    );
    if (contributors.length === 0) return 'Coming soon';
    const names = contributors.map((id) => getProvider(id)?.displayName ?? id);
    return `Add ${names.join(', ')} to unlock ${k.toUpperCase()}`;
  };

  function statusOf(row: { templateId: string; enabled: boolean }): string {
    if (!row.enabled) return '✗ Not connected';
    const needsProxy = getProvider(row.templateId)?.corsHint === 'requires-proxy';
    if (needsProxy && !hasProxy) return '✗ Needs proxy';
    return '● Connected';
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'AI Providers' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
        <CorsProxyBlock />

        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
            What you have
          </div>
          <CapBadgeRow lit={lit} tooltipFor={tooltipFor} />
        </div>

        {rows.length === 0 ? (
          <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
            Your Circle has no voice yet — add a provider to begin.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => navigate(`/app/settings/providers/${row.templateId}`)}
                className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
              >
                <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
                  {BUILT_IN_PROVIDERS.find((b) => b.id === row.templateId)?.monogram ??
                    row.templateId.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm text-paper">
                    {getProvider(row.templateId)?.displayName ?? row.templateId}
                  </div>
                  <div className="text-xs text-paper-soft">{statusOf(row)}</div>
                  <div className="mt-1">
                    <CapBadgeRow lit={providerServiceKinds(row.templateId)} />
                  </div>
                </div>
                <span className="text-paper-soft">▸</span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setPicking(true)}
          className="rounded-md border border-dashed border-white/15 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper"
        >
          + Add provider
        </button>

        {picking ? (
          <AddProviderPicker
            configuredTemplateIds={rows.map((r) => r.templateId)}
            hasProxy={hasProxy}
            onPick={(id: ProviderTemplateId) => {
              setPicking(false);
              navigate(`/app/settings/providers/${id}`);
            }}
            onNeedProxy={() => setPicking(false)}
            onClose={() => setPicking(false)}
          />
        ) : null}
      </div>
    </PageScaffold>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-providers`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
git add apps/user-client/src/routes/app/settings/providers.tsx apps/user-client/tests/component/settings-providers.test.tsx
git commit -m "Add My Settings › AI Providers overview sub-page"
```

---

### Task 6: **Per-provider** sub-page (`:templateId`)

Replace the `ProviderSheet` bottom-sheet with a real page. Port the probe/seal/save logic from `ProviderSheet.tsx:46-133` **verbatim**, with exactly these changes: (a) both `onClose()` calls become `navigate('/app/settings/providers')`; (b) the remove flow uses `ConfirmDialog` (gold-protects cancel) instead of a bare button; (c) wrap in `PageScaffold`.

**Files:**
- Create: `apps/user-client/src/routes/app/settings/provider.tsx`
- Test: `apps/user-client/tests/component/settings-provider.test.tsx`

**Interfaces:**
- Consumes: `useParams`, `useNavigate`, `getProvider`, `probeProvider`, `useSessionStore`, `useProviders`/`useUpsertProvider`/`useDeleteProvider`, `useSettings`, `openSecret`/`sealSecret`, `CapBadgeRow`, `providerServiceKinds`, `ConfirmDialog`, `PageScaffold`, `useHelp('settings-providers')`.
- Produces: `export function SettingsProviderPage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/settings-provider.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsProviderPage } from '../../src/routes/app/settings/provider.js';

function wrapAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/settings/providers/:templateId" element={<SettingsProviderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsProviderPage', () => {
  it('renders an API-key field and a Test & Save action for a known provider', async () => {
    wrapAt('/app/settings/providers/chutes');
    expect(await screen.findByLabelText(/API key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /test & save/i })).toBeInTheDocument();
  });

  it('shows an unknown-provider notice for an unknown id', async () => {
    wrapAt('/app/settings/providers/not-a-provider');
    expect(await screen.findByText(/unknown provider/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

Structure (port the marked logic verbatim):

```tsx
// apps/user-client/src/routes/app/settings/provider.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { getProvider, probeProvider, providerServiceKinds } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CapBadgeRow } from '../../../components/CapBadgeRow.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useDeleteProvider, useProviders, useUpsertProvider } from '../../../data/providers.js';
import { useSettings } from '../../../data/settings.js';
import { openSecret, sealSecret } from '../../../lib/secrets.js';

type Status =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok' }
  | { kind: 'error'; reason: string };

export function SettingsProviderPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-providers');
  const navigate = useNavigate();
  const { templateId = '' } = useParams();
  const definition = getProvider(templateId);

  const providers = useProviders();
  const settings = useSettings();
  const upsert = useUpsertProvider();
  const del = useDeleteProvider();
  const mk = useSessionStore((s) => s.mk);

  const existing = providers.data?.find((p) => p.templateId === templateId);
  const requiresProxy = definition?.corsHint === 'requires-proxy';

  const [apiKey, setApiKey] = useState('');
  const [revealKey, setRevealKey] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const back = () => navigate('/app/settings/providers');

  // ── PORT VERBATIM from ProviderSheet.tsx:46-133 (the `onSave` body), with the
  //    sole change that the two `onClose()` calls become `back()`. The needs-proxy
  //    guard message stays ("Set a CORS proxy first (My Settings → AI Providers)" —
  //    update the page name to AI Providers).
  async function onSave() {
    /* …verbatim port… */
  }

  if (!definition) {
    return (
      <PageScaffold
        crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'AI Providers', to: '/app/settings/providers' }, { label: 'Unknown' }]}
        back="/app/settings/providers"
        onHelp={onHelp}
      >
        {helpOverlay}
        <p className="px-4 pt-4 text-sm text-paper-soft">Unknown provider.</p>
      </PageScaffold>
    );
  }

  const displayName = definition.displayName ?? templateId;

  return (
    <PageScaffold
      crumbs={[
        { label: 'My Settings', to: '/app/settings' },
        { label: 'AI Providers', to: '/app/settings/providers' },
        { label: displayName },
      ]}
      back="/app/settings/providers"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
            {displayName.slice(0, 2)}
          </div>
          <div className="font-display text-sm text-paper">{displayName}</div>
        </div>

        <CapBadgeRow lit={providerServiceKinds(templateId)} />

        <div>
          <label htmlFor="ps-api-key" className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">
            API key
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

        {status.kind !== 'idle' ? (
          <div
            data-testid="sheet-status"
            className={`rounded-md border px-3 py-2 text-xs ${
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
                ? '✓ Key valid · LLM unlocked'
                : `✗ ${(status as { kind: 'error'; reason: string }).reason}`}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving}
          className="rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Test & Save'}
        </button>

        {existing ? (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="self-start rounded-md border px-3 py-1 text-xs uppercase tracking-wider"
            style={{ borderColor: 'var(--color-destructive)', color: 'var(--color-destructive-text)' }}
          >
            Remove provider
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${displayName}?`}
        body="The key is deleted. Personas using this provider won't be able to connect."
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          if (existing) void del.mutateAsync(existing.id).then(back);
        }}
      />
    </PageScaffold>
  );
}
```

> Copy the `onSave` body verbatim from `ProviderSheet.tsx:46-133`. The only edits: the two `onClose()` calls → `back()`, and the needs-proxy reason text → "Set a CORS proxy first (My Settings → AI Providers)". Do not otherwise alter the crypto/probe sequence.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-provider`
Expected: PASS (2 tests).

- [ ] **Step 5: Gate + commit**

```bash
git add apps/user-client/src/routes/app/settings/provider.tsx apps/user-client/tests/component/settings-provider.test.tsx
git commit -m "Add per-provider settings page replacing the provider sheet"
```

---

### Task 7: **Web Access** sub-page

A `PickerField` opening the general `WebPickerOverlay`. Port the data wiring from `WebInterfacingSettings` (`settings.tsx:308-337`): `webBackendOptions(usable, hasProxy)`, the no-options/needs-proxy notice, and the `webInterfacing` value.

**Files:**
- Create: `apps/user-client/src/routes/app/settings/web.tsx`
- Test: `apps/user-client/tests/component/settings-web.test.tsx`

**Interfaces:**
- Consumes: `WebPickerOverlay`, `WebPickerValue`, `PickerField`, `useUsableTemplateIds`, `useSettings`/`useUpdateSettings`, `webBackendOptions`, `aggregateServiceKinds`, `PageScaffold`, `useHelp('settings-web')`.
- Produces: `export function SettingsWebPage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/settings-web.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsWebPage } from '../../src/routes/app/settings/web.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsWebPage', () => {
  it('renders the Web Access crumb and a needs-provider notice with no web offering', async () => {
    wrap(<SettingsWebPage />);
    expect(await screen.findByText('Web Access')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-web`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

```tsx
// apps/user-client/src/routes/app/settings/web.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { aggregateServiceKinds } from '@chatsundere/llm-unified';
import { useRef, useState } from 'react';
import { WebPickerOverlay, type WebPickerValue } from '../../../components/WebPickerOverlay.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { PickerField } from '../../../components/ui/PickerField.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { useUsableTemplateIds } from '../../../lib/usable-providers.js';
import { webBackendOptions } from '../../../lib/web-backend-options.js';

export function SettingsWebPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-web');
  const usable = useUsableTemplateIds();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const hasWeb = aggregateServiceKinds(usable).includes('web');
  const hasProxy = settings.data?.corsProxy != null;
  const options = webBackendOptions(usable, hasProxy);
  const wi = settings.data?.webInterfacing ?? { search: null, fetch: null };

  const body = (() => {
    if (!hasWeb) {
      return (
        <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
          None of your providers offers web access yet — add a web-capable provider under AI
          Providers.
        </p>
      );
    }
    if (options.length === 0) {
      return (
        <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
          Web search and fetch need a CORS proxy. Set one up under AI Providers to enable them.
        </p>
      );
    }
    return (
      <>
        <PickerField
          label="Web search & fetch"
          value="Search & fetch the internet"
          onOpen={(el) => {
            triggerRef.current = el;
            setOpen(true);
          }}
        />
        <WebPickerOverlay
          open={open}
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          title="Web search"
          mode="general"
          options={options}
          searchTiers={[]}
          initial={{ search: wi.search, fetch: wi.fetch, searchTierId: null }}
          onSave={(next: WebPickerValue) => {
            void update.mutateAsync({ webInterfacing: { search: next.search, fetch: next.fetch } });
            setOpen(false);
          }}
        />
      </>
    );
  })();

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Web Access' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">{body}</div>
    </PageScaffold>
  );
}
```

> Confirm the exact shape of `settings.webInterfacing` and the `onChange` payload against `WebInterfacingSection`/`settings.tsx:326-334` before wiring `onSave`; match it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-web`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
git add apps/user-client/src/routes/app/settings/web.tsx apps/user-client/tests/component/settings-web.test.tsx
git commit -m "Add My Settings › Web Access sub-page"
```

---

### Task 8: **Voice** sub-page

Rehouse `VoiceSection` (it already persists immediately and owns its internal states) inside a `PageScaffold`.

**Files:**
- Create: `apps/user-client/src/routes/app/settings/voice.tsx`
- Test: `apps/user-client/tests/component/settings-voice.test.tsx`

**Interfaces:**
- Consumes: `VoiceSection`, `PageScaffold`, `useHelp('settings-voice')`.
- Produces: `export function SettingsVoicePage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/settings-voice.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsVoicePage } from '../../src/routes/app/settings/voice.js';

describe('SettingsVoicePage', () => {
  it('renders the Voice crumb and the voice section', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsVoicePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Voice')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-voice`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

```tsx
// apps/user-client/src/routes/app/settings/voice.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { VoiceSection } from '../../../components/voice/VoiceSection.js';
import { useHelp } from '../../../content/help/use-help.js';

export function SettingsVoicePage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-voice');
  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Voice' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="px-4 pb-8 pt-2">
        <VoiceSection />
      </div>
    </PageScaffold>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-voice`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
git add apps/user-client/src/routes/app/settings/voice.tsx apps/user-client/tests/component/settings-voice.test.tsx
git commit -m "Add My Settings › Voice sub-page"
```

---

### Task 9: **Images** sub-page

Two blocks under plain-language headings (Laura SOFT-3): **Reading images** (substitute-vision via `ModelSlotPicker` filter='vision') and **Creating images** (the existing `ImageGenerationSection`, rehoused as-is). Port the substitute-vision wiring from `SubstituteVisionSetting` (`settings.tsx:79-106`): the `parseModelRef` parse, `usableTemplateIds`, persist `${templateId}:${upstreamSlug}` to `substituteVisionModel`, `onClear` → null.

**Files:**
- Create: `apps/user-client/src/routes/app/settings/images.tsx`
- Test: `apps/user-client/tests/component/settings-images.test.tsx`

**Interfaces:**
- Consumes: `ModelSlotPicker` (Task 2), `ImageGenerationSection`, `useSettings`/`useUpdateSettings`, `useProviders`, `usableTemplateIds`, `PageScaffold`, `useHelp('settings-images')`.
- Produces: `export function SettingsImagesPage(): JSX.Element`. Also a local `parseModelRef` helper (copy from `settings.tsx:40-47`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/settings-images.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsImagesPage } from '../../src/routes/app/settings/images.js';

describe('SettingsImagesPage', () => {
  it('renders the Reading images and Creating images blocks', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsImagesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Reading images')).toBeInTheDocument();
    expect(screen.getByText('Creating images')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-images`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

```tsx
// apps/user-client/src/routes/app/settings/images.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { ImageGenerationSection } from '../../../components/image-gen/ImageGenerationSection.js';
import { ModelSlotPicker } from '../../../components/ModelSlotPicker.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useProviders } from '../../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { usableTemplateIds } from '../../../lib/usable-providers.js';

function parseModelRef(
  ref: string | null | undefined,
): { providerTemplateId: string; upstreamSlug: string } | null {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  return { providerTemplateId: ref.slice(0, idx), upstreamSlug: ref.slice(idx + 1) };
}

export function SettingsImagesPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-images');
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const rows = providerRows ?? [];
  const configuredTemplateIds = usableTemplateIds(rows, !!settings?.corsProxy);
  const current = parseModelRef(settings?.substituteVisionModel);

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Images' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-6 px-4 pb-8 pt-2">
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-sm text-paper">Reading images</h2>
          <p className="text-[11px] text-paper-soft">
            When your active model can't see images, this model reads them for it. One global choice.
          </p>
          <ModelSlotPicker
            label="Image-reading model"
            valueLabel={current ? `${current.providerTemplateId} · ${current.upstreamSlug}` : ''}
            emptyLabel="None — pick a vision model"
            filter="vision"
            providers={rows}
            configuredTemplateIds={configuredTemplateIds}
            current={current}
            onSelect={(sel) =>
              update.mutate({ substituteVisionModel: `${sel.providerTemplateId}:${sel.upstreamSlug}` })
            }
            onClear={() => update.mutate({ substituteVisionModel: null })}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-sm text-paper">Creating images</h2>
          <ImageGenerationSection />
        </section>
      </div>
    </PageScaffold>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-images`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
git add apps/user-client/src/routes/app/settings/images.tsx apps/user-client/tests/component/settings-images.test.tsx
git commit -m "Add My Settings › Images sub-page"
```

---

### Task 10: **"Ask an Expert"** sub-page

Expert-model (`ModelSlotPicker` filter='all') + expert-web (`WebPickerOverlay` mode='expert' via a `PickerField`), with the disabled-with-reason states ported from `ExpertModelSetting` (`settings.tsx:113-143`) and `ExpertWebSettings` (`settings.tsx:252-297`): no web offering → notice; no expert model → notice; else the expert-web picker with `searchTiers` from the chosen search backend (see `settings.tsx:283-286`, `pickExpertSearchRef` + `getOffering(...).web.searchTiers`).

**Files:**
- Create: `apps/user-client/src/routes/app/settings/expert.tsx`
- Test: `apps/user-client/tests/component/settings-expert.test.tsx`

**Interfaces:**
- Consumes: `ModelSlotPicker`, `WebPickerOverlay`, `PickerField`, `useSettings`/`useUpdateSettings`, `useProviders`, `useUsableTemplateIds`, `usableTemplateIds`, `aggregateServiceKinds`, `webBackendOptions`, `pickExpertSearchRef`, `getOffering`, `PageScaffold`, `useHelp('settings-expert')`.
- Produces: `export function SettingsExpertPage(): JSX.Element`. Local `parseModelRef` (copy as in Task 9).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/settings-expert.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsExpertPage } from '../../src/routes/app/settings/expert.js';

describe('SettingsExpertPage', () => {
  it('renders the expert-model slot and the privacy reassurance', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsExpertPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Expert model/i)).toBeInTheDocument();
    expect(screen.getByText(/only the sanitised question/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-expert`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

Compose: a `ModelSlotPicker` for the expert model (persist `expertModel` as `${templateId}:${upstreamSlug}`, `onClear` → null), the two privacy `<p>`s (copy from `settings.tsx:122-129`), then an **Expert web** block:
- `const hasWeb = aggregateServiceKinds(usable).includes('web')`; if not → notice "Add a web-capable provider under AI Providers".
- else if `settings.expertModel == null` → notice "Choose an expert model above to enable the expert's web access."
- else → a `PickerField` "Expert search & fetch" opening `WebPickerOverlay` mode='expert', `options = webBackendOptions(usable, hasProxy)`, `searchTiers` resolved as in `settings.tsx:283-286`, `initial` from `settings.expertWeb ?? { search:null, fetch:null, searchTierId:null }`, `onSave` → `update.mutate({ expertWeb: next })`.

Follow the exact data resolution from `ExpertWebSettings` (`settings.tsx:252-297`) — copy the `pickExpertSearchRef` + `getOffering(...).web?.searchTiers ?? []` lines verbatim. Wrap in `PageScaffold` (crumbs `My Settings › "Ask an Expert"`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-expert`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
git add apps/user-client/src/routes/app/settings/expert.tsx apps/user-client/tests/component/settings-expert.test.tsx
git commit -m 'Add My Settings › "Ask an Expert" sub-page'
```

---

### Task 11: Root matrix page (rewrite `settings.tsx`)

Replace the entire accordion file with the 3×2 `NavTile` matrix. Compute tile state (provider count; web availability) from the live hooks. Mirror `account.tsx:115-211`.

**Files:**
- Modify (rewrite): `apps/user-client/src/routes/app/settings.tsx`
- Test: `apps/user-client/tests/component/settings-root.test.tsx`

**Interfaces:**
- Consumes: `NavTile`, `PageScaffold`, `useHelp('settings')`, `useProviders`, `useSettings`, `usableTemplateIds`, `aggregateServiceKinds`, Lucide icons.
- Produces: `export function Settings(): JSX.Element` (name unchanged — `App.tsx` imports `Settings as MySettings`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/settings-root.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Settings } from '../../src/routes/app/settings.js';

describe('My Settings root matrix', () => {
  it('renders all six tiles', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    for (const label of ['You', 'AI Providers', 'Web Access', 'Voice', 'Images', '"Ask an Expert"']) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('disables Web Access when no provider offers web', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const web = await screen.findByRole('button', { name: 'Web Access' });
    expect(web).toHaveAttribute('aria-disabled', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test settings-root`
Expected: FAIL — old accordion has no tiles.

- [ ] **Step 3: Write the page**

```tsx
// apps/user-client/src/routes/app/settings.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { aggregateServiceKinds } from '@chatsundere/llm-unified';
import { AudioLines, Boxes, Globe, Image as ImageIcon, Sparkles, User } from 'lucide-react';
import { NavTile } from '../../components/ui/NavTile.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { usableTemplateIds } from '../../lib/usable-providers.js';

/** My Settings — the root navigation matrix (spec §2). */
export function Settings(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings');
  const providers = useProviders();
  const settings = useSettings();

  const rows = providers.data ?? [];
  const hasProxy = !!settings.data?.corsProxy;
  const usable = usableTemplateIds(rows, hasProxy);
  const hasWeb = aggregateServiceKinds(usable).includes('web');
  const providerCount = rows.length;

  return (
    <PageScaffold crumbs={[{ label: 'My Settings' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <div className="grid grid-cols-2 gap-3 px-4 pb-8 pt-2">
        <NavTile colour="pink" icon={User} label="You" to="/app/settings/you" meta="how the AI sees you" />
        <NavTile
          colour="pink"
          icon={Boxes}
          label="AI Providers"
          to="/app/settings/providers"
          meta={providerCount === 0 ? 'none yet' : `${providerCount} provider${providerCount === 1 ? '' : 's'}`}
        />
        <NavTile
          colour="blue"
          icon={Globe}
          label="Web Access"
          to={hasWeb ? '/app/settings/web' : undefined}
          meta={hasWeb ? 'search & fetch the internet' : undefined}
          disabled={!hasWeb}
          disabledReason="Add a web-capable provider under AI Providers to enable."
        />
        <NavTile colour="blue" icon={AudioLines} label="Voice" to="/app/settings/voice" meta="read-aloud & dictation" />
        <NavTile colour="purple" icon={ImageIcon} label="Images" to="/app/settings/images" meta="reading & creating images" />
        <NavTile
          colour="purple"
          icon={Sparkles}
          label={'"Ask an Expert"'}
          to="/app/settings/expert"
          meta="delegate hard questions"
        />
      </div>
    </PageScaffold>
  );
}
```

> Remove every now-unused import/helper from the old file (`AccordionCard`, `AddProviderPicker`, `ProviderSheet`, `SubstituteVisionSetting`, etc.). Their logic now lives on the sub-pages. If any of those exported helpers (`SubstituteVisionSetting`, `ExpertModelSetting`, `ProvidersSection`) is imported elsewhere, grep first (`rg "SubstituteVisionSetting|ExpertModelSetting|ProvidersSection"`) — they should have no other consumers; if one does, that consumer is part of this rewrite.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test settings-root`
Expected: PASS (2 tests).

- [ ] **Step 5: Gate + commit**

```bash
git add apps/user-client/src/routes/app/settings.tsx apps/user-client/tests/component/settings-root.test.tsx
git commit -m "Rebuild My Settings root as a navigation matrix"
```

---

### Task 12: Wire routes, remove `ProviderSheet`, final gate

**Files:**
- Modify: `apps/user-client/src/App.tsx`
- Delete: `apps/user-client/src/components/ProviderSheet.tsx`

- [ ] **Step 1: Register the seven routes**

In `App.tsx`, beside `<Route path="/app/settings" element={<MySettings />} />` (line ~116), add imports and routes:

```tsx
import { SettingsYouPage } from './routes/app/settings/you.js';
import { SettingsProvidersPage } from './routes/app/settings/providers.js';
import { SettingsProviderPage } from './routes/app/settings/provider.js';
import { SettingsWebPage } from './routes/app/settings/web.js';
import { SettingsVoicePage } from './routes/app/settings/voice.js';
import { SettingsImagesPage } from './routes/app/settings/images.js';
import { SettingsExpertPage } from './routes/app/settings/expert.js';
```

```tsx
<Route path="/app/settings/you" element={<SettingsYouPage />} />
<Route path="/app/settings/providers" element={<SettingsProvidersPage />} />
<Route path="/app/settings/providers/:templateId" element={<SettingsProviderPage />} />
<Route path="/app/settings/web" element={<SettingsWebPage />} />
<Route path="/app/settings/voice" element={<SettingsVoicePage />} />
<Route path="/app/settings/images" element={<SettingsImagesPage />} />
<Route path="/app/settings/expert" element={<SettingsExpertPage />} />
```

All inside the existing `<Route element={<ProtectedRoute />}>` block.

- [ ] **Step 2: Remove the dead `ProviderSheet`**

Run: `rg -l "ProviderSheet" apps/user-client/src` — expect no matches after Task 11. Then:
```bash
git rm apps/user-client/src/components/ProviderSheet.tsx
```
If `rg` still finds a reference, fix that consumer first (it should only have been `settings.tsx`, already rewritten).

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck --force`
Expected: all packages pass (14/14 per the project baseline).

Run: `pnpm --filter @chatsundere/user-client test`
Expected: the **8 Node-localStorage baseline** failures only; every new settings suite green.

Run: `pnpm --filter @chatsundere/user-client run build` (full TS pipeline, per CLAUDE.md §10).
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/App.tsx
git rm apps/user-client/src/components/ProviderSheet.tsx
git commit -m "Wire My Settings sub-routes and retire the provider sheet"
```

---

## Self-Review

**Spec coverage:**
- §2 root matrix → Task 11 (tiles, colours, disabled Web, metas). ✓
- §2.2 disabled-over-hidden → Task 11 (Web tile) + per-page internal states (Tasks 7, 9, 10). ✓
- §3 You (about-me, instructions, mindspace, blur-flush, identity seam) → Tasks 1, 4 + help doc Task 3. ✓
- §4 AI Providers overview → Task 5; §4.1 per-provider → Task 6. ✓
- §5 Web Access → Task 7. ✓
- §6 Voice → Task 8. ✓
- §7 Images (reading/creating, vision-lock, NSFW already present) → Tasks 2, 9. ✓
- §8 "Ask an Expert" → Task 10. ✓
- §9 new/removed components → Tasks 1, 2, 6 (new), 12 (ProviderSheet removed). ✓
- §10 routing → Task 12. ✓
- §11 error/edge → stale (Task 2 PickerField/ModelSlotPicker), empty states (Tasks 7, 9, 10), probe failure (Task 6), disabled focusable (Task 11). ✓
- §13 testing / §14 manual verification → per-task tests + final full-suite gate (Task 12). The manual device checklist (spec §14) is Chris's, post-merge.

**Placeholder scan:** the two "PORT VERBATIM" markers (Task 6 `onSave`, and the cited ports in Tasks 5/7/9/10) name **exact source line ranges** to copy and the **exact** edits to make — not vague "implement later". Acceptable: re-typing 90 lines of crypto/probe logic that already exists verbatim would risk transcription error; citing `ProviderSheet.tsx:46-133` + the two changes is more precise.

**Type consistency:** `MindspaceSelection` (`{mindspaceId, texture, font}`), `WebPickerValue` (`{search, fetch, searchTierId}`), `ModelSelection` (from `onSelect`), `ModelSlotPickerProps`, and the `settings.*` field names (`globalAboutMe`, `globalInstructions`, `defaultMindspaceId`, `userTexture`, `substituteVisionModel`, `expertModel`, `expertWeb`, `webInterfacing`, `imageGeneration`, `corsProxy`, `displayName`) are all taken verbatim from the read source. Verify `MindspaceRow`'s display field name in Task 4 (flagged inline).

---

## Execution Handoff

Plan complete. Recommended: **subagent-driven** — one fresh subagent per task, two-stage review (spec-conformance + quality) between tasks, full-suite + `typecheck --force` gate per task. Serial dispatch only (one implementer per turn; never batch onto a shared tree).
