# Model Picker Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one reusable, animated `ModelPickerField` (trigger button + bottom-sheet `ModelPickerModal`) that selects a model → then a provider, and use it at all three model-selection sites (persona editor, substitute-vision, ask-expert).

**Architecture:** A two-step bottom-sheet modal (family-grouped, searchable model list → provider list for the chosen model). Pure data/search helpers are unit-tested; the React components and animation are verified on device. Selection returns a `ModelSelection` carrying both the provider template id and the configured DB row id, so each call site maps it to its own storage shape.

**Tech Stack:** React 18, TypeScript (strict), Tailwind v4, Vitest. Catalogue helpers from `@chatsundere/llm-unified`. CSS keyframes only — no animation library.

Spec: `superpowers/specs/2026-06-08-model-picker-modal-design.md`.

**Task order is topological over the import graph** — each task compiles and typechecks on its own. Do not reorder.

---

### Task 1: Extract shared model trust badges

Create a shared badge module so the modal and (later) other call sites reuse the exact badges currently inlined in `persona-editor.tsx`. This task only **creates** the new file — it does not touch `persona-editor.tsx` yet (those local copies are removed in Task 6, keeping every intermediate state compiling).

**Files:**
- Create: `apps/user-client/src/components/ModelTrustBadges.tsx`

- [ ] **Step 1: Create the badges file**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import type { FreedomState } from '@chatsundere/llm-unified';

/** TEE / ZDR trust pills, in the shared aurora/success palette. */
export function TrustBadge({ kind }: { kind: 'tee' | 'zdr' }): JSX.Element {
  const cfg =
    kind === 'tee'
      ? {
          label: 'TEE',
          title: 'Trusted Execution Environment — the host cannot read your data',
          cls: 'bg-success/15 text-success border-success/40',
        }
      : {
          label: 'ZDR',
          title: 'Zero Data Retention — the provider stores nothing after the request',
          cls: 'bg-aurora-500/20 text-aurora-200 border-aurora-500/50',
        };
  return (
    <span
      title={cfg.title}
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

/**
 * The loud, honest signal for a censored model. Only 'restricted' carries a
 * badge today (free/unknown stay unmarked); restricted means the model — or its
 * deployment — applies content restrictions somewhere in the stack.
 */
export function FreedomBadge({ state }: { state: FreedomState }): JSX.Element | null {
  if (state !== 'restricted') return null;
  return (
    <span
      title="This model is censored by its maker. Reached via an anonymising router — the server never sees your data — but the model itself applies content restrictions."
      className="rounded border border-danger/40 bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-danger"
    >
      Censored
    </span>
  );
}

/** Jurisdiction badge — the legal home of the deployment (e.g. EU). */
export function JurisdictionBadge({ code }: { code: string }): JSX.Element {
  return (
    <span
      title={`Jurisdiction: ${code}`}
      className="rounded border border-aurora-500/40 bg-aurora-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aurora-200"
    >
      {code}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: PASS (new file compiles; nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/components/ModelTrustBadges.tsx
git commit -m "Extract shared model trust badges"
```

---

### Task 2: Pure picker data helpers + tests (TDD)

The risk areas — family grouping order, empty-group removal, search semantics — are pure functions over plain inputs, so they are unit-tested without coupling to catalogue contents.

**Files:**
- Create: `apps/user-client/src/components/model-picker/model-picker-data.ts`
- Test: `apps/user-client/src/components/model-picker/model-picker-data.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import type { CanonicalModel } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import {
  type FamilyGroup,
  type PickerModel,
  filterGroupsByQuery,
  groupModelsByFamily,
} from './model-picker-data.js';

function canonical(id: string, displayName: string, family: string): CanonicalModel {
  return {
    id,
    displayName,
    family,
    requiredCaps: { tools: false, reasoning: false, vision: false },
    freedomOriented: null,
  };
}

function model(displayName: string, family: string, sortPriority: number): PickerModel {
  return {
    canonical: canonical(displayName.toLowerCase().replaceAll(' ', '-'), displayName, family),
    offers: [],
    teeAvailable: false,
    zdrAvailable: false,
    sortPriority,
  };
}

describe('groupModelsByFamily', () => {
  it('buckets models by family, families ordered by lowest sortPriority then name', () => {
    const groups = groupModelsByFamily([
      model('Opus', 'claude', 5),
      model('DeepSeek V4', 'deepseek', 1),
      model('Haiku', 'claude', 9),
      model('GLM 5', 'glm', 1),
    ]);
    // deepseek (1) and glm (1) tie on priority → alphabetical; claude (5) last.
    expect(groups.map((g) => g.family)).toEqual(['deepseek', 'glm', 'claude']);
    const claude = groups.find((g) => g.family === 'claude') as FamilyGroup;
    // Within a family, input order is preserved (curated catalogue order).
    expect(claude.models.map((m) => m.canonical.displayName)).toEqual(['Opus', 'Haiku']);
  });
});

describe('filterGroupsByQuery', () => {
  const base = groupModelsByFamily([
    model('Claude Opus 4.8', 'claude', 5),
    model('Claude Haiku', 'claude', 5),
    model('DeepSeek V4', 'deepseek', 1),
  ]);

  it('returns all groups unchanged for an empty or whitespace query', () => {
    expect(filterGroupsByQuery(base, '')).toEqual(base);
    expect(filterGroupsByQuery(base, '   ')).toEqual(base);
  });

  it('matches case-insensitively, trimmed, by substring on displayName', () => {
    const r = filterGroupsByQuery(base, '  OPUS ');
    expect(r).toHaveLength(1);
    expect(r[0]?.family).toBe('claude');
    expect(r[0]?.models.map((m) => m.canonical.displayName)).toEqual(['Claude Opus 4.8']);
  });

  it('drops families whose every model is filtered out', () => {
    const r = filterGroupsByQuery(base, 'deepseek');
    expect(r.map((g) => g.family)).toEqual(['deepseek']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/model-picker/model-picker-data.test.ts`
Expected: FAIL — cannot resolve `./model-picker-data.js` (module not yet created).

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import {
  type CanonicalModel,
  type Offering,
  getProvider,
  listCanonicals,
  listOfferings,
} from '@chatsundere/llm-unified';
import type { ProviderRow } from '../../boot/client-data-db.js';

export type ModelFilter = 'all' | 'vision';

/** A configured, filter-matching deployment of one canonical model. */
export interface PickerOffering {
  offering: Offering;
  /** Configured provider DB row id (what the persona draft stores). */
  providerRowId: string;
  providerDisplayName: string;
}

/** One canonical model with its reachable deployments. */
export interface PickerModel {
  canonical: CanonicalModel;
  offers: PickerOffering[];
  teeAvailable: boolean;
  zdrAvailable: boolean;
  /** Lowest provider sortPriority among `offers`; drives family ordering. */
  sortPriority: number;
}

export interface FamilyGroup {
  family: string;
  models: PickerModel[];
  sortPriority: number;
}

export interface PickerData {
  groups: FamilyGroup[];
  /** Canonicals relevant to the filter but with no reachable deployment yet. */
  hiddenCount: number;
}

/** The value the modal hands back; each call site maps it to its own storage. */
export interface ModelSelection {
  canonicalId: string;
  providerTemplateId: string;
  providerRowId: string;
  upstreamSlug: string;
}

/**
 * Group models under their family heading. Families are ordered by the lowest
 * provider sortPriority among their members (higher-priority providers' families
 * surface first), tie-broken alphabetically. Within a family the input order is
 * preserved, which is the curated catalogue order.
 */
export function groupModelsByFamily(models: PickerModel[]): FamilyGroup[] {
  const byFamily = new Map<string, PickerModel[]>();
  for (const m of models) {
    const arr = byFamily.get(m.canonical.family);
    if (arr) arr.push(m);
    else byFamily.set(m.canonical.family, [m]);
  }
  const groups: FamilyGroup[] = [];
  for (const [family, members] of byFamily) {
    const sortPriority = Math.min(...members.map((m) => m.sortPriority));
    groups.push({ family, models: members, sortPriority });
  }
  groups.sort((a, b) => a.sortPriority - b.sortPriority || a.family.localeCompare(b.family));
  return groups;
}

/**
 * Filter groups by a search query against model display names. Case-insensitive,
 * trimmed, substring ("contains"). An empty/whitespace query returns the groups
 * unchanged; families with no surviving model are dropped.
 */
export function filterGroupsByQuery(groups: FamilyGroup[], query: string): FamilyGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const out: FamilyGroup[] = [];
  for (const g of groups) {
    const models = g.models.filter((m) => m.canonical.displayName.toLowerCase().includes(q));
    if (models.length > 0) out.push({ ...g, models });
  }
  return out;
}

/**
 * Build the picker's model groups from the user's configured providers. An
 * offering counts only when its provider is both enabled (a DB row exists) and
 * usable (in `configuredTemplateIds`, which already accounts for the CORS proxy).
 * `hiddenCount` is how many otherwise-matching models would unlock with more
 * providers.
 */
export function buildPickerData(
  providers: ProviderRow[],
  configuredTemplateIds: string[],
  filter: ModelFilter,
): PickerData {
  const configuredByTemplate = new Map(
    providers.filter((p) => p.enabled).map((p) => [p.templateId, p] as const),
  );
  const usable = new Set(configuredTemplateIds);
  const matchesFilter = (o: Offering): boolean => filter === 'all' || o.profile.vision;

  const models: PickerModel[] = [];
  let hiddenCount = 0;

  for (const canonical of listCanonicals()) {
    // `listOfferings` is already rank-sorted (TEE → freedom → priority → confidence).
    const matching = listOfferings(canonical.id).filter(matchesFilter);
    if (matching.length === 0) continue; // not relevant to this filter at all

    const offers: PickerOffering[] = [];
    for (const offering of matching) {
      const row = configuredByTemplate.get(offering.providerId);
      if (!row || !usable.has(offering.providerId)) continue;
      offers.push({
        offering,
        providerRowId: row.id,
        providerDisplayName: getProvider(offering.providerId)?.displayName ?? offering.providerId,
      });
    }

    if (offers.length === 0) {
      hiddenCount += 1; // exists for this filter, just not on a configured provider
      continue;
    }

    const sortPriority = Math.min(
      ...offers.map(
        (o) => getProvider(o.offering.providerId)?.sortPriority ?? Number.MAX_SAFE_INTEGER,
      ),
    );
    models.push({
      canonical,
      offers,
      teeAvailable: offers.some((o) => o.offering.trust.tee),
      zdrAvailable: offers.some((o) => o.offering.trust.zdr),
      sortPriority,
    });
  }

  return { groups: groupModelsByFamily(models), hiddenCount };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/model-picker/model-picker-data.test.ts`
Expected: PASS (3 describe blocks, all green).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
git add apps/user-client/src/components/model-picker/model-picker-data.ts apps/user-client/src/components/model-picker/model-picker-data.test.ts
git commit -m "Add model-picker data helpers (family grouping, search)"
```

---

### Task 3: Sheet open/close animation keyframes

Add the CSS keyframes the modal uses to animate in and out. Mirrors the existing keyframe style in `index.css` (e.g. `wizard-step-in`).

**Files:**
- Modify: `apps/user-client/src/index.css` (append near the existing `@keyframes` block)

- [ ] **Step 1: Append the keyframes**

Add at the end of the keyframes section of `apps/user-client/src/index.css`:

```css
@keyframes picker-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes picker-backdrop-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes picker-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes picker-sheet-out {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}
```

- [ ] **Step 2: Typecheck (CSS is build-checked) and commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
git add apps/user-client/src/index.css
git commit -m "Add model-picker sheet animation keyframes"
```

---

### Task 4: ModelPickerModal component

The bottom-sheet itself: two steps, sticky search, family-grouped models → provider list, single-click-provider closes, animated open/close, Escape + backdrop dismiss, constructive empty state.

**Files:**
- Create: `apps/user-client/src/components/ModelPickerModal.tsx`

- [ ] **Step 1: Create the modal**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { effectiveFreedom } from '@chatsundere/llm-unified';
import { useEffect, useMemo, useState } from 'react';
import type { ProviderRow } from '../boot/client-data-db.js';
import { FreedomBadge, JurisdictionBadge, TrustBadge } from './ModelTrustBadges.js';
import {
  type ModelFilter,
  type ModelSelection,
  type PickerModel,
  buildPickerData,
  filterGroupsByQuery,
} from './model-picker/model-picker-data.js';

export interface ModelPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (sel: ModelSelection) => void;
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  filter?: ModelFilter;
  /** Marks the active deployment with a check, in provider-template-id space. */
  current?: { providerTemplateId: string; upstreamSlug: string } | null;
  onBrowseProviders?: () => void;
}

export function ModelPickerModal({
  open,
  onClose,
  onSelect,
  providers,
  configuredTemplateIds,
  filter = 'all',
  current,
  onBrowseProviders,
}: ModelPickerModalProps): JSX.Element | null {
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCanonicalId, setActiveCanonicalId] = useState<string | null>(null);

  // Fresh state every time the sheet opens.
  useEffect(() => {
    if (open) {
      setClosing(false);
      setQuery('');
      setActiveCanonicalId(null);
    }
  }, [open]);

  // Escape closes (with the out-animation) while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setClosing(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const data = useMemo(
    () => buildPickerData(providers, configuredTemplateIds, filter),
    [providers, configuredTemplateIds, filter],
  );
  const visibleGroups = useMemo(() => filterGroupsByQuery(data.groups, query), [data.groups, query]);

  const activeModel: PickerModel | null = useMemo(() => {
    if (!activeCanonicalId) return null;
    for (const g of data.groups) {
      const m = g.models.find((x) => x.canonical.id === activeCanonicalId);
      if (m) return m;
    }
    return null;
  }, [data.groups, activeCanonicalId]);

  if (!open && !closing) return null;

  const requestClose = (): void => setClosing(true);

  const onSheetAnimationEnd = (): void => {
    if (closing) {
      setClosing(false);
      onClose();
    }
  };

  const pick = (model: PickerModel, offerIndex: number): void => {
    const o = model.offers[offerIndex];
    if (!o) return;
    onSelect({
      canonicalId: model.canonical.id,
      providerTemplateId: o.offering.providerId,
      providerRowId: o.providerRowId,
      upstreamSlug: o.offering.upstreamSlug,
    });
    requestClose();
  };

  return (
    <>
      <div
        data-app-backdrop
        className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
        style={{
          animation: `${closing ? 'picker-backdrop-out' : 'picker-backdrop-in'} 200ms ease forwards`,
        }}
        onClick={requestClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') requestClose();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Dismiss"
      />
      <div
        data-app-sheet
        className="fixed inset-x-0 bottom-0 z-30 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-white/10 bg-ink shadow-2xl"
        style={{
          animation: `${closing ? 'picker-sheet-out 200ms ease-in' : 'picker-sheet-in 240ms cubic-bezier(0.16, 1, 0.3, 1)'} forwards`,
        }}
        onAnimationEnd={onSheetAnimationEnd}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 pb-2">
          {activeModel ? (
            <button
              type="button"
              aria-label="Back to models"
              onClick={() => setActiveCanonicalId(null)}
              className="flex items-center gap-2 font-display text-sm text-paper"
            >
              <span aria-hidden className="text-paper-soft">
                ‹
              </span>
              {activeModel.canonical.displayName}
            </button>
          ) : (
            <span className="font-display text-sm text-paper">Choose a model</span>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            className="rounded-full p-1 text-paper-soft hover:text-paper"
          >
            ×
          </button>
        </div>

        {/* Step 1: model list (with sticky search) */}
        {!activeModel ? (
          <>
            <div className="sticky top-0 z-10 bg-ink px-4 pb-3">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models"
                aria-label="Search models"
                className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-paper placeholder:text-paper-soft/60 focus:border-white/20 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
              {visibleGroups.length === 0 ? (
                <EmptyState hiddenCount={data.hiddenCount} onBrowseProviders={onBrowseProviders} />
              ) : (
                visibleGroups.map((g) => (
                  <div key={g.family} className="flex flex-col gap-2">
                    <div className="text-[11px] uppercase tracking-wider text-paper-soft/70">
                      {g.family}
                    </div>
                    {g.models.map((m) => (
                      <button
                        key={m.canonical.id}
                        type="button"
                        onClick={() => setActiveCanonicalId(m.canonical.id)}
                        className="flex items-center justify-between gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
                      >
                        <div className="font-display text-sm text-paper">
                          {m.canonical.displayName}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-paper-soft">
                          {m.teeAvailable ? <TrustBadge kind="tee" /> : null}
                          {m.zdrAvailable ? <TrustBadge kind="zdr" /> : null}
                          <span>
                            {m.offers.length} provider{m.offers.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          /* Step 2: provider list for the chosen model */
          <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
            {activeModel.offers.map((po, i) => {
              const o = po.offering;
              const isActive =
                current?.providerTemplateId === o.providerId &&
                current?.upstreamSlug === o.upstreamSlug;
              return (
                <button
                  key={`${o.providerId}:${o.upstreamSlug}`}
                  type="button"
                  onClick={() => pick(activeModel, i)}
                  className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${
                    isActive
                      ? 'border-paper bg-white/[0.04]'
                      : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm text-paper">
                        {po.providerDisplayName}
                      </span>
                      {o.trust.tee ? <TrustBadge kind="tee" /> : null}
                      {o.trust.zdr ? <TrustBadge kind="zdr" /> : null}
                      {o.trust.jurisdiction ? <JurisdictionBadge code={o.trust.jurisdiction} /> : null}
                      <FreedomBadge
                        state={effectiveFreedom(
                          activeModel.canonical.freedomOriented,
                          o.freedomOrientedDeployment,
                        )}
                      />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-paper-soft">
                      <span>{o.context.recommended.toLocaleString()} ctx</span>
                      <span className="flex gap-1">
                        {o.profile.toolCalls.supported ? (
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">
                            Tools
                          </span>
                        ) : null}
                        {o.profile.vision ? (
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">
                            Vision
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                  {isActive ? <span>✓</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function EmptyState({
  hiddenCount,
  onBrowseProviders,
}: {
  hiddenCount: number;
  onBrowseProviders?: () => void;
}): JSX.Element {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-center">
      <p className="text-sm text-paper-soft">
        {hiddenCount > 0
          ? `${hiddenCount} model${hiddenCount === 1 ? '' : 's'} unlock once you add a provider.`
          : 'No models match your search.'}
      </p>
      {hiddenCount > 0 && onBrowseProviders ? (
        <button
          type="button"
          onClick={onBrowseProviders}
          className="mt-2 text-[11px] text-aurora-200 underline"
        >
          Add a provider → My Settings
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
git add apps/user-client/src/components/ModelPickerModal.tsx
git commit -m "Add ModelPickerModal bottom-sheet (two-step, search, animation)"
```

---

### Task 5: ModelPickerField component

The public, reusable entry point each call site imports: a trigger button summarising the current selection (with a stale-aware danger variant and optional clear), hosting `ModelPickerModal`.

**Files:**
- Create: `apps/user-client/src/components/ModelPickerField.tsx`

- [ ] **Step 1: Create the field**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { getCanonical, getOffering, getProvider } from '@chatsundere/llm-unified';
import { useState } from 'react';
import type { ProviderRow } from '../boot/client-data-db.js';
import { ModelPickerModal } from './ModelPickerModal.js';
import type { ModelFilter, ModelSelection } from './model-picker/model-picker-data.js';

export interface ModelPickerFieldProps {
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  filter?: ModelFilter;
  /** Current selection in provider-template-id space; null = nothing chosen. */
  current: { providerTemplateId: string; upstreamSlug: string } | null;
  onSelect: (sel: ModelSelection) => void;
  /** When provided and a selection exists, a Clear control appears. */
  onClear?: () => void;
  onBrowseProviders?: () => void;
  /** Label shown on the trigger when nothing is selected (e.g. "Choose a model"). */
  emptyLabel: string;
}

export function ModelPickerField({
  providers,
  configuredTemplateIds,
  filter = 'all',
  current,
  onSelect,
  onClear,
  onBrowseProviders,
  emptyLabel,
}: ModelPickerFieldProps): JSX.Element {
  const [open, setOpen] = useState(false);

  let label = emptyLabel;
  let stale = false;
  if (current) {
    const offering = getOffering(current.providerTemplateId, current.upstreamSlug);
    const stillConfigured = providers.some(
      (p) => p.enabled && p.templateId === current.providerTemplateId,
    );
    if (offering && stillConfigured) {
      const canon = offering.canonicalRef ? getCanonical(offering.canonicalRef) : undefined;
      const prov = getProvider(current.providerTemplateId);
      label = `${canon?.displayName ?? offering.upstreamSlug} · ${prov?.displayName ?? current.providerTemplateId}`;
    } else {
      stale = true;
      label = 'Currently unavailable';
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex flex-1 items-center justify-between gap-3 rounded-md border p-3 text-left ${
          stale
            ? 'border-danger/30 bg-danger/[0.04]'
            : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
        }`}
      >
        <span className={`font-display text-sm ${stale ? 'text-danger' : 'text-paper'}`}>
          {label}
        </span>
        <span aria-hidden className="text-paper-soft">
          ›
        </span>
      </button>
      {onClear && current ? (
        <button
          type="button"
          aria-label="Clear selection"
          onClick={onClear}
          className="rounded-full p-2 text-paper-soft hover:text-paper"
        >
          ×
        </button>
      ) : null}
      <ModelPickerModal
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
        onBrowseProviders={onBrowseProviders}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
git add apps/user-client/src/components/ModelPickerField.tsx
git commit -m "Add ModelPickerField trigger + modal host"
```

---

### Task 6: Wire the persona editor

Replace the inline `ModelList` with `ModelPickerField`, delete `ModelList` and the three now-shared badge functions, and prune the imports that only `ModelList` used.

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`

- [ ] **Step 1: Replace the `<ModelList>` call site**

In the `{/* ❷ Model */}` `AccordionCard` (around line 526), replace the whole `<ModelList ... />` element with:

```tsx
<ModelPickerField
  providers={providers.data ?? []}
  configuredTemplateIds={usableTemplateIds(providers.data ?? [], !!settings.data?.corsProxy)}
  filter="all"
  current={(() => {
    const row = providers.data?.find((p) => p.id === draft.providerId);
    return row && draft.modelId
      ? { providerTemplateId: row.templateId, upstreamSlug: draft.modelId }
      : null;
  })()}
  onSelect={(sel) =>
    patch({
      canonicalId: sel.canonicalId,
      providerId: sel.providerRowId,
      modelId: sel.upstreamSlug,
    })
  }
  onBrowseProviders={() => navigate('/app/settings')}
  emptyLabel="Choose a model"
/>
```

- [ ] **Step 2: Delete the now-dead local code**

Delete these from `persona-editor.tsx`:
- `function ModelList(...)` (the whole function, ~lines 937–1099).
- `function TrustBadge(...)`, `function FreedomBadge(...)`, `function JurisdictionBadge(...)` (~lines 879–935).

- [ ] **Step 3: Add the field import and prune dead imports**

Add to the component imports:

```tsx
import { ModelPickerField } from '../../components/ModelPickerField.js';
```

In the `@chatsundere/llm-unified` import block, keep only what's still used (`modelMeta` uses `getCanonical` and `getProvider`); replace the block with:

```tsx
import { getCanonical, getProvider } from '@chatsundere/llm-unified';
```

(Removing `type FreedomState`, `type Offering`, `availableCanonicals`, `effectiveFreedom`, `getOffering`, `listOfferings`, which only `ModelList`/the badges used.)

- [ ] **Step 4: Verify no dangling references**

Run: `rg -n "ModelList|TrustBadge|JurisdictionBadge|FreedomBadge|availableCanonicals|listOfferings|getOffering|effectiveFreedom|FreedomState|\bOffering\b" apps/user-client/src/routes/app/persona-editor.tsx`
Expected: no matches (all removed). If any remain, they are genuinely still used — re-add only that import.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
git add apps/user-client/src/routes/app/persona-editor.tsx
git commit -m "Use ModelPickerField in persona editor"
```

---

### Task 7: Wire the substitute-vision and ask-expert settings

Replace both native `<select>` pickers with `ModelPickerField`. They store `"${providerTemplateId}:${upstreamSlug}"` and keep their clear-to-null behaviour via `onClear`.

**Files:**
- Modify: `apps/user-client/src/routes/app/settings.tsx`

- [ ] **Step 1: Add imports**

Add to the imports of `settings.tsx`:

```tsx
import { ModelPickerField } from '../../components/ModelPickerField.js';
import { useProviders } from '../../data/providers.js';
import { usableTemplateIds } from '../../lib/usable-providers.js';
```

(`useProviders` and `usableTemplateIds` may already be imported elsewhere in this file — if so, do not duplicate.)

Add a small ref parser near the top of the file (module scope):

```tsx
/** Parse a stored "${templateId}:${upstreamSlug}" ref into picker `current`. */
function parseModelRef(
  ref: string | null | undefined,
): { providerTemplateId: string; upstreamSlug: string } | null {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  return { providerTemplateId: ref.slice(0, idx), upstreamSlug: ref.slice(idx + 1) };
}
```

- [ ] **Step 2: Rewrite `SubstituteVisionSetting`**

Replace the body of `SubstituteVisionSetting` (everything inside the function) with:

```tsx
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const rows = providerRows ?? [];
  const configuredTemplateIds = usableTemplateIds(rows, !!settings?.corsProxy);

  return (
    <div>
      <p className="mb-3 text-[11px] text-paper-soft">
        Route images through a vision-capable model, so a chat model that can&apos;t see images on
        its own can still read them. One global choice for all personas — used only when your active
        model cannot see images.
      </p>
      <ModelPickerField
        providers={rows}
        configuredTemplateIds={configuredTemplateIds}
        filter="vision"
        current={parseModelRef(settings?.substituteVisionModel)}
        onSelect={(sel) =>
          update.mutate({ substituteVisionModel: `${sel.providerTemplateId}:${sel.upstreamSlug}` })
        }
        onClear={() => update.mutate({ substituteVisionModel: null })}
        emptyLabel="None — pick a vision model"
      />
    </div>
  );
```

- [ ] **Step 3: Rewrite `ExpertModelSetting`**

Replace the body of `ExpertModelSetting` with:

```tsx
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const rows = providerRows ?? [];
  const configuredTemplateIds = usableTemplateIds(rows, !!settings?.corsProxy);

  return (
    <div>
      <p className="mb-3 text-[11px] text-paper-soft">
        When you tap "Ask an expert", the active model delegates your question to this model for a
        stronger answer. One global choice — applies across all personas.
      </p>
      <p className="mb-3 text-[11px] text-paper-soft">
        Only the sanitised question you see in the pill leaves your device — never your
        conversation, persona, or personal details.
      </p>
      <ModelPickerField
        providers={rows}
        configuredTemplateIds={configuredTemplateIds}
        filter="all"
        current={parseModelRef(settings?.expertModel)}
        onSelect={(sel) =>
          update.mutate({ expertModel: `${sel.providerTemplateId}:${sel.upstreamSlug}` })
        }
        onClear={() => update.mutate({ expertModel: null })}
        emptyLabel="None — pick an expert model"
      />
    </div>
  );
```

- [ ] **Step 4: Prune now-unused imports**

If `listProviders` (and any of `getProvider`, `ServiceKind` etc.) are no longer referenced in `settings.tsx` after these edits, remove them from the `@chatsundere/llm-unified` import block. Verify:

Run: `rg -n "listProviders|<select|cockpit-select" apps/user-client/src/routes/app/settings.tsx`
Expected: the two model-picker selects are gone; `listProviders` only remains if used by `ProvidersSection` further down (leave it if so).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @chatsundere/user-client typecheck
git add apps/user-client/src/routes/app/settings.tsx
git commit -m "Use ModelPickerField for substitute-vision and ask-expert settings"
```

---

### Task 8: Full verification

- [ ] **Step 1: Full typecheck (the CI gate) across the workspace**

Run: `pnpm typecheck`
Expected: all packages PASS.

- [ ] **Step 2: Full user-client test suite**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: PASS, including the new `model-picker-data.test.ts`. Investigate any failure against `master` before dismissing it as pre-existing.

- [ ] **Step 3: Biome lint/format**

Run: `pnpm --filter @chatsundere/user-client exec biome check --write src/components/ModelPickerModal.tsx src/components/ModelPickerField.tsx src/components/ModelTrustBadges.tsx src/components/model-picker/ src/routes/app/persona-editor.tsx src/routes/app/settings.tsx`
Expected: clean (or auto-fixed). Re-commit if files changed.

- [ ] **Step 4: Manual verification (Chris, on device)** — restart `pnpm dev` first (Vite HMR ignores `packages/*`, but these are app edits; restart is still the safe baseline):
  - Persona editor → Model: trigger button shows current selection; opens the animated sheet; search filters by name; family headings render; tap a model → provider step with back arrow (back preserves search); single-tap provider selects and the sheet animates closed; the accordion summary updates.
  - Settings → Substitute vision: only vision-capable models appear; clear (×) unsets it.
  - Settings → Ask expert: all models appear; selecting and clearing both work.
  - With zero providers configured: the sheet shows the constructive empty state with "Add a provider".
  - A persona whose stored model is no longer reachable: the trigger shows the danger "Currently unavailable" state and still opens the picker.

**After Task 8 passes, the lead (Liz) squashes the per-task commits into one feature commit and updates `obsidian/STATUS-CLIENT-ONLY.md`. Subagents do not squash, merge, push, or switch branches.**
