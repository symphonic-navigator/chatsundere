# Provider & Model Handling Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Straighten out provider/model handling — derived modality caps, a global CORS-proxy home, an add-from-catalogue picker, and a configured-only model picker, with the *dere* treatment throughout.

**Architecture:** Modality is a new `ServiceKind` on `Offering`, derived (never declared) into provider/summary caps. The user-client gains a shared "usable provider" definition, three new components (`CapBadgeRow`, `CorsProxyBlock`, `AddProviderPicker`), a reworked Upstream-Providers section, a slimmed `ProviderSheet`, and a configured-only model picker. No persisted-state change → no Dexie migration.

**Tech Stack:** TypeScript (strict), `packages/llm-unified` (Bun test runner), `apps/user-client` (React 18 + Vite + Vitest + TanStack Query + Dexie).

**Spec:** [[../specs/2026-05-31-provider-model-handling-rework-design]]

**Security gate:** Larissa is **not** required — no path under `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, or `packages/crypto` is touched (CLAUDE.md §9). `ProviderSheet`/`CorsProxyBlock` use the app-level `lib/secrets.ts` wrapper, not `packages/crypto`.

**Commit discipline:** one checkpoint commit per task (free-form imperative, `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`, **no** `[skip ci]` — these are code). Liz squashes the whole unit into one commit after Chris's device test (CLAUDE.md §8).

**Test commands:**
- llm-unified: `cd packages/llm-unified && bun test src/<file>.test.ts`
- user-client: `cd apps/user-client && pnpm vitest run src/<path>.test.tsx`
- Repo gate: `pnpm typecheck` (from root)

---

## Part A — `packages/llm-unified`: data model & helpers

### Task 1: `ServiceKind` + `Offering.serviceKind` + backfill

**Files:**
- Modify: `packages/llm-unified/src/catalogue/types.ts`
- Modify: every offering factory — `packages/llm-unified/src/providers/{chutes,tensorix,mistral,wafer,novita,ollama-cloud,nano-gpt,openrouter}.ts`
- Test: `packages/llm-unified/src/offerings.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `offerings.test.ts`:

```ts
import type { ServiceKind } from './catalogue/types.js';

describe('offering serviceKind', () => {
  test('every built-in offering declares serviceKind llm (today all LLM)', () => {
    _resetRegistryForTests();
    registerBuiltins();
    for (const c of listCanonicals()) {
      for (const o of listOfferings(c.id)) {
        expect(o.serviceKind).toBe('llm');
      }
    }
  });

  test('ServiceKind union is the five modalities (no emb)', () => {
    const kinds: ServiceKind[] = ['llm', 'web', 'tts', 'stt', 'tti'];
    expect(kinds.length).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/offerings.test.ts`
Expected: FAIL — `o.serviceKind` is `undefined` (not `'llm'`) and/or `ServiceKind` not exported.

- [ ] **Step 3: Add the type** — in `catalogue/types.ts`, above `Offering`:

```ts
/** A modality a provider contributes, derived from its curated offerings. */
export type ServiceKind = 'llm' | 'web' | 'tts' | 'stt' | 'tti';
```

Add the field to `Offering` (after `source`/`confidence` block, keep it required):

```ts
export interface Offering {
  // … existing fields …
  /** Modality this offering provides. Currently always 'llm'. */
  serviceKind: ServiceKind;
}
```

- [ ] **Step 4: Backfill every offering factory** — each provider file builds offerings through a local factory (e.g. `waferOffering` in `wafer.ts:33-53`, `chutesOffering`, `tensorixOffering`, `novita…`, etc.). Add `serviceKind: 'llm',` to the returned object literal of **each** factory. For any provider that builds offering literals inline (no factory), add `serviceKind: 'llm',` to each literal. Grep to confirm none missed:

Run: `cd packages/llm-unified && rg -n "providerId:" src/providers/ | wc -l` and `rg -n "serviceKind:" src/providers/ | wc -l` — the two counts must match.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/offerings.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd /home/chris/workspace/chatsundere && pnpm typecheck`
Expected: clean (the required field forces every literal to be updated; a miss surfaces here).

- [ ] **Step 7: Commit**

```bash
git add packages/llm-unified/src/catalogue/types.ts packages/llm-unified/src/providers packages/llm-unified/src/offerings.test.ts
git commit -m "Add ServiceKind modality to Offering, backfill built-ins as llm

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: provider modality derivation helpers

**Files:**
- Modify: `packages/llm-unified/src/registry.ts`
- Modify: `packages/llm-unified/src/index.ts` (export new symbols)
- Test: `packages/llm-unified/src/registry.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `registry.test.ts`:

```ts
import {
  providerServiceKinds,
  aggregateServiceKinds,
  providersContributing,
  MODALITY_ORDER,
} from './index.js';

describe('modality derivation', () => {
  test('MODALITY_ORDER is the five modalities in display order', () => {
    expect(MODALITY_ORDER).toEqual(['llm', 'web', 'tts', 'stt', 'tti']);
  });

  test('providerServiceKinds returns the distinct modalities of a provider', () => {
    _resetRegistryForTests();
    registerBuiltins();
    expect(providerServiceKinds('wafer')).toEqual(['llm']); // all wired llm today
  });

  test('providerServiceKinds is empty for an unknown provider', () => {
    _resetRegistryForTests();
    registerBuiltins();
    expect(providerServiceKinds('does-not-exist')).toEqual([]);
  });

  test('aggregateServiceKinds unions across the given providers, in MODALITY_ORDER', () => {
    _resetRegistryForTests();
    registerBuiltins();
    expect(aggregateServiceKinds(['wafer', 'chutes'])).toEqual(['llm']);
    expect(aggregateServiceKinds([])).toEqual([]);
  });

  test('providersContributing lists template ids whose offerings provide a kind', () => {
    _resetRegistryForTests();
    registerBuiltins();
    const llmProviders = providersContributing('llm');
    expect(llmProviders).toContain('wafer');
    expect(providersContributing('tts')).toEqual([]); // nothing wired yet
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/registry.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement in `registry.ts`** (append; `ServiceKind` is imported from the catalogue types):

```ts
import type { Offering, ServiceKind } from './catalogue/types.js';

/** Canonical display order for modality badges. */
export const MODALITY_ORDER: ServiceKind[] = ['llm', 'web', 'tts', 'stt', 'tti'];

function orderKinds(set: Set<ServiceKind>): ServiceKind[] {
  return MODALITY_ORDER.filter((k) => set.has(k));
}

/** Distinct modalities this provider contributes, from its curated offerings. */
export function providerServiceKinds(providerId: string): ServiceKind[] {
  const defn = getProvider(providerId);
  if (!defn) return [];
  return orderKinds(new Set(defn.offerings.map((o) => o.serviceKind)));
}

/** Union of contributed modalities across the given (usable) providers. */
export function aggregateServiceKinds(templateIds: string[]): ServiceKind[] {
  const set = new Set<ServiceKind>();
  for (const id of templateIds) for (const k of providerServiceKinds(id)) set.add(k);
  return orderKinds(set);
}

/** Template ids of registered providers whose offerings provide a given kind. */
export function providersContributing(kind: ServiceKind): string[] {
  return listProviders()
    .filter((p) => p.offerings.some((o) => o.serviceKind === kind))
    .map((p) => p.id);
}
```

(Note: `ServiceKind` may already be importable via the existing `Offering` import line — merge the import rather than duplicating it. `MODALITY_ORDER`'s element type satisfies the `ServiceKind` union exhaustively; if a future kind is added, update this array.)

- [ ] **Step 4: Export from `index.ts`** — add to the `registry.js` re-export line:

```ts
export {
  registerProvider, getProvider, listProviders, rankOfferings, listOfferings, getOffering,
  providerServiceKinds, aggregateServiceKinds, providersContributing, MODALITY_ORDER,
} from './registry.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/registry.ts packages/llm-unified/src/index.ts packages/llm-unified/src/registry.test.ts
git commit -m "Derive provider/aggregate modality caps from offerings

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: `availableCanonicals` model-availability helper

**Files:**
- Modify: `packages/llm-unified/src/canonical-registry.ts`
- Modify: `packages/llm-unified/src/index.ts` (export)
- Test: `packages/llm-unified/src/canonical-registry.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `canonical-registry.test.ts`:

```ts
import { _resetRegistryForTests, registerBuiltins, availableCanonicals } from './index.js';

describe('availableCanonicals', () => {
  test('no configured providers → nothing available, all hidden', () => {
    _resetRegistryForTests();
    registerBuiltins();
    const total = listCanonicals().length;
    const { available, hiddenCount } = availableCanonicals([]);
    expect(available).toEqual([]);
    expect(hiddenCount).toBe(total);
  });

  test('one configured provider → only its canonicals are available', () => {
    _resetRegistryForTests();
    registerBuiltins();
    const total = listCanonicals().length;
    const { available, hiddenCount } = availableCanonicals(['wafer']);
    expect(available.length).toBeGreaterThan(0);
    expect(available.length).toBeLessThan(total); // wafer does not offer every canonical
    expect(hiddenCount).toBe(total - available.length);
    // every available canonical must actually have a wafer offering
    for (const c of available) {
      expect(listOfferings(c.id).some((o) => o.providerId === 'wafer')).toBe(true);
    }
  });
});
```

(Ensure `listOfferings` and `listCanonicals` are imported at the top of the test — `listCanonicals` already is.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/canonical-registry.test.ts`
Expected: FAIL — `availableCanonicals` not exported.

- [ ] **Step 3: Implement in `canonical-registry.ts`**:

```ts
import { listOfferings } from './registry.js';

/**
 * Canonicals the user can actually use: those with >= 1 offering on a
 * configured (usable) provider. Returns the available list plus the count of
 * hidden canonicals, for the model picker's quiet footer.
 */
export function availableCanonicals(configuredTemplateIds: string[]): {
  available: CanonicalModel[];
  hiddenCount: number;
} {
  const configured = new Set(configuredTemplateIds);
  const all = listCanonicals();
  const available = all.filter((c) =>
    listOfferings(c.id).some((o) => configured.has(o.providerId)),
  );
  return { available, hiddenCount: all.length - available.length };
}
```

- [ ] **Step 4: Export from `index.ts`**:

```ts
export { canonicalById, listCanonicals, availableCanonicals } from './canonical-registry.js';
```

(Remove the duplicate `canonicalById, listCanonicals` re-export currently on `index.ts:17` while here — consolidate to one line.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/canonical-registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Full llm-unified suite + typecheck**

Run: `cd packages/llm-unified && bun test` then `cd /home/chris/workspace/chatsundere && pnpm typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-unified/src/canonical-registry.ts packages/llm-unified/src/index.ts packages/llm-unified/src/canonical-registry.test.ts
git commit -m "Add availableCanonicals for configured-only model listing

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Part B — `apps/user-client`: shared "usable" definition

### Task 4: `usableTemplateIds` pure helper + hook

**Files:**
- Create: `apps/user-client/src/lib/usable-providers.ts`
- Test: `apps/user-client/src/lib/usable-providers.test.ts`

- [ ] **Step 1: Write the failing test**:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { ProviderRow } from '../boot/client-data-db.js';
import { usableTemplateIds } from './usable-providers.js';

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (id: string) =>
    id === 'wafer' ? { corsHint: 'requires-proxy' } : { corsHint: 'direct' },
}));

const row = (templateId: string, enabled: boolean): ProviderRow =>
  ({ id: `r-${templateId}`, templateId, enabled }) as ProviderRow;

describe('usableTemplateIds', () => {
  it('includes enabled direct providers', () => {
    expect(usableTemplateIds([row('chutes', true)], false)).toEqual(['chutes']);
  });

  it('excludes disabled providers', () => {
    expect(usableTemplateIds([row('chutes', false)], true)).toEqual([]);
  });

  it('excludes proxy-required providers when no proxy is set', () => {
    expect(usableTemplateIds([row('wafer', true)], false)).toEqual([]);
  });

  it('includes proxy-required providers when a proxy is set', () => {
    expect(usableTemplateIds([row('wafer', true)], true)).toEqual(['wafer']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/lib/usable-providers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `usable-providers.ts`**:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider } from '@chatsundere/llm-unified';
import { useMemo } from 'react';
import type { ProviderRow } from '../boot/client-data-db.js';
import { useProviders } from '../data/providers.js';
import { useSettings } from '../data/settings.js';

/**
 * Template ids of *usable* providers: enabled AND with a working route —
 * either not proxy-required, or a CORS proxy is configured. The single source
 * of truth for the summary and model availability (spec §5 "usable provider").
 */
export function usableTemplateIds(providers: ProviderRow[], hasProxy: boolean): string[] {
  return providers
    .filter((p) => p.enabled)
    .filter((p) => getProvider(p.templateId)?.corsHint !== 'requires-proxy' || hasProxy)
    .map((p) => p.templateId);
}

/** Hook form: reads providers + settings and returns usable template ids. */
export function useUsableTemplateIds(): string[] {
  const providers = useProviders();
  const settings = useSettings();
  const hasProxy = !!settings.data?.corsProxy;
  return useMemo(
    () => usableTemplateIds(providers.data ?? [], hasProxy),
    [providers.data, hasProxy],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/lib/usable-providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/usable-providers.ts apps/user-client/src/lib/usable-providers.test.ts
git commit -m "Add usable-provider derivation (enabled + working route)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Part C — `apps/user-client`: shared components

### Task 5: `CapBadgeRow` (modality summary, reusable)

**Files:**
- Create: `apps/user-client/src/components/CapBadgeRow.tsx`
- Test: `apps/user-client/src/components/CapBadgeRow.test.tsx`

- [ ] **Step 1: Write the failing test**:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CapBadgeRow } from './CapBadgeRow.js';

describe('CapBadgeRow', () => {
  it('renders all five modality badges in order', () => {
    render(<CapBadgeRow lit={['llm']} />);
    for (const label of ['LLM', 'WEB', 'TTS', 'STT', 'TTI']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('marks lit modalities as on and others as off', () => {
    render(<CapBadgeRow lit={['llm']} />);
    expect(screen.getByText('LLM').getAttribute('data-lit')).toBe('true');
    expect(screen.getByText('WEB').getAttribute('data-lit')).toBe('false');
  });

  it('applies the tooltip for a greyed modality when provided', () => {
    render(<CapBadgeRow lit={['llm']} tooltipFor={(k) => (k === 'web' ? 'Add nano-gpt to unlock WEB' : 'Coming soon')} />);
    expect(screen.getByText('WEB').getAttribute('title')).toBe('Add nano-gpt to unlock WEB');
    expect(screen.getByText('TTS').getAttribute('title')).toBe('Coming soon');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/CapBadgeRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CapBadgeRow.tsx`**:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { MODALITY_ORDER, type ServiceKind } from '@chatsundere/llm-unified';

const LABEL: Record<ServiceKind, string> = {
  llm: 'LLM',
  web: 'WEB',
  tts: 'TTS',
  stt: 'STT',
  tti: 'TTI',
};

/**
 * The modality summary row. Lit badges show what the user (or a provider)
 * contributes; greyed badges show what is missing, with a constructive tooltip.
 * Reusable — Integrations will reuse this for plugin capability badges.
 */
export function CapBadgeRow({
  lit,
  tooltipFor,
}: {
  lit: ServiceKind[];
  tooltipFor?: (kind: ServiceKind) => string;
}): JSX.Element {
  const litSet = new Set(lit);
  return (
    <div className="flex flex-wrap gap-1.5">
      {MODALITY_ORDER.map((k) => {
        const on = litSet.has(k);
        return (
          <span
            key={k}
            data-lit={on ? 'true' : 'false'}
            title={on ? undefined : tooltipFor?.(k)}
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
              on
                ? 'border-success/40 bg-success/15 text-success'
                : 'border-white/10 bg-white/[0.02] text-paper-soft/40'
            }`}
          >
            {LABEL[k]}
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/components/CapBadgeRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/CapBadgeRow.tsx apps/user-client/src/components/CapBadgeRow.test.tsx
git commit -m "Add CapBadgeRow modality summary component

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: `CorsProxyBlock` (global proxy, transitional)

**Files:**
- Create: `apps/user-client/src/components/CorsProxyBlock.tsx`
- Test: `apps/user-client/src/components/CorsProxyBlock.test.tsx`

- [ ] **Step 1: Write the failing test**:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const updateMock = vi.fn(async () => {});
let proxyState: { url: string; sharedKey: unknown } | null = null;
let providerRows: Array<{ templateId: string; enabled: boolean }> = [];

vi.mock('../data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: proxyState } }),
  useUpdateSettings: () => ({ mutateAsync: updateMock }),
}));
vi.mock('../data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));
vi.mock('../lib/secrets.js', () => ({ sealSecret: vi.fn(async () => ({ ct: 'x', iv: 'y' })) }));
vi.mock('@chatsundere/ui-shared', () => ({ useSessionStore: () => 'mk' }));
vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (id: string) => ({ corsHint: id === 'wafer' ? 'requires-proxy' : 'direct', displayName: id }),
}));

import { CorsProxyBlock } from './CorsProxyBlock.js';

describe('CorsProxyBlock', () => {
  it('shows the transitional caption', () => {
    proxyState = null; providerRows = [];
    render(<CorsProxyBlock />);
    expect(screen.getByText(/server connection at beta/i)).toBeInTheDocument();
  });

  it('shows "not set" when no proxy is configured', () => {
    proxyState = null; providerRows = [];
    render(<CorsProxyBlock />);
    expect(screen.getByText(/no proxy set/i)).toBeInTheDocument();
  });

  it('clears the proxy without confirm when no proxy-provider is active', async () => {
    proxyState = { url: 'https://p.example', sharedKey: { ct: 'a', iv: 'b' } };
    providerRows = [{ templateId: 'chutes', enabled: true }];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CorsProxyBlock />);
    screen.getByRole('button', { name: /clear/i }).click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({ corsProxy: null });
    confirmSpy.mockRestore();
  });

  it('warns before clearing when a proxy-provider is active', async () => {
    proxyState = { url: 'https://p.example', sharedKey: { ct: 'a', iv: 'b' } };
    providerRows = [{ templateId: 'wafer', enabled: true }];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    updateMock.mockClear();
    render(<CorsProxyBlock />);
    screen.getByRole('button', { name: /clear/i }).click();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/wafer/i));
    expect(updateMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/CorsProxyBlock.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CorsProxyBlock.tsx`**:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useProviders } from '../data/providers.js';
import { useSettings, useUpdateSettings } from '../data/settings.js';
import { sealSecret } from '../lib/secrets.js';

/**
 * Global CORS-proxy configuration. Transitional alpha scaffolding — at beta the
 * authenticated proxy moves server-side and this block is removed (spec §13).
 */
export function CorsProxyBlock(): JSX.Element {
  const settings = useSettings();
  const providers = useProviders();
  const update = useUpdateSettings();
  const mk = useSessionStore((s) => s.mk);

  const current = settings.data?.corsProxy ?? null;
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(current?.url ?? '');
  const [shared, setShared] = useState('');

  async function onSave() {
    if (!mk || !url) return;
    const sharedKey = shared
      ? await sealSecret(shared, mk, 'cors-proxy/shared-key')
      : current?.sharedKey;
    if (!sharedKey) return;
    await update.mutateAsync({ corsProxy: { url, sharedKey } });
    setShared('');
    setEditing(false);
  }

  function onClear() {
    const active = (providers.data ?? [])
      .filter((p) => p.enabled && getProvider(p.templateId)?.corsHint === 'requires-proxy')
      .map((p) => getProvider(p.templateId)?.displayName ?? p.templateId);
    if (active.length > 0) {
      const ok = window.confirm(
        `${active.join(', ')} need this proxy and will become unavailable until you set one again. Remove the proxy?`,
      );
      if (!ok) return;
    }
    void update.mutateAsync({ corsProxy: null });
    setUrl('');
    setEditing(false);
  }

  return (
    <div className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.04] p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-paper-soft">
          CORS Proxy · advanced
        </span>
        {current ? (
          <span className="text-[10px] text-success">● Set</span>
        ) : (
          <span className="text-[10px] text-paper-soft">No proxy set</span>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            aria-label="Proxy URL"
            type="text"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            data-1p-ignore
            name=""
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
          />
          <input
            aria-label="Shared key"
            type="password"
            placeholder={current ? 'leave blank to keep current' : 'shared secret'}
            value={shared}
            onChange={(e) => setShared(e.target.value)}
            autoComplete="off"
            data-1p-ignore
            name=""
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="flex-1 rounded-md border border-paper-soft/30 px-3 py-1.5 text-xs uppercase tracking-wider text-paper-soft">
              Cancel
            </button>
            <button type="button" onClick={() => void onSave()} className="flex-1 rounded-md bg-paper px-3 py-1.5 text-xs uppercase tracking-wider text-ink">
              Save proxy
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-paper-soft">
            {current?.url ?? '—'}
          </span>
          <button type="button" onClick={() => { setUrl(current?.url ?? ''); setEditing(true); }} className="rounded-md border border-paper-soft/30 px-2 py-1 text-[11px] uppercase tracking-wider text-paper-soft hover:text-paper">
            {current ? 'Edit' : 'Set'}
          </button>
          {current ? (
            <button type="button" onClick={onClear} className="rounded-md border border-danger/40 px-2 py-1 text-[11px] uppercase tracking-wider text-danger hover:bg-danger/10">
              Clear
            </button>
          ) : null}
        </div>
      )}

      <p className="mt-2 text-[11px] text-paper-soft/70">
        Temporary — replaced by your server connection at beta.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/components/CorsProxyBlock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/CorsProxyBlock.tsx apps/user-client/src/components/CorsProxyBlock.test.tsx
git commit -m "Add CorsProxyBlock for global proxy config and removal

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: `AddProviderPicker` (the `+` chooser)

**Files:**
- Create: `apps/user-client/src/components/AddProviderPicker.tsx`
- Test: `apps/user-client/src/components/AddProviderPicker.test.tsx`

Provider display metadata (id, name, monogram) is the existing `BUILT_IN_PROVIDERS` array; lift it out of `settings.tsx` into a shared module so both the picker and the list use it.

- [ ] **Step 1: Create the shared metadata module** `apps/user-client/src/lib/built-in-providers.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Display metadata for the built-in providers (monograms are curated). */
export const BUILT_IN_PROVIDERS = [
  { id: 'chutes', name: 'Chutes', monogram: 'Ch' },
  { id: 'tensorix', name: 'Tensorix', monogram: 'Te' },
  { id: 'mistral', name: 'Mistral AI', monogram: 'Mi' },
  { id: 'wafer', name: 'Wafer', monogram: 'Wa' },
  { id: 'novita', name: 'Novita AI', monogram: 'No' },
  { id: 'ollama-cloud', name: 'Ollama Cloud', monogram: 'Ol' },
  { id: 'nano-gpt', name: 'nano-gpt.com', monogram: 'nG' },
  { id: 'openrouter', name: 'OpenRouter', monogram: 'OR' },
] as const;

export type ProviderTemplateId = (typeof BUILT_IN_PROVIDERS)[number]['id'];
```

- [ ] **Step 2: Write the failing test** `AddProviderPicker.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@chatsundere/llm-unified', () => ({
  MODALITY_ORDER: ['llm', 'web', 'tts', 'stt', 'tti'],
  getProvider: (id: string) => ({
    corsHint: id === 'wafer' || id === 'ollama-cloud' ? 'requires-proxy' : 'direct',
    offerings: [{ serviceKind: 'llm', freedomOrientedDeployment: id === 'chutes' }],
    sortPriority: id === 'chutes' ? 10 : 50,
  }),
  providerServiceKinds: () => ['llm'],
}));

import { AddProviderPicker } from './AddProviderPicker.js';

const noop = () => {};

describe('AddProviderPicker', () => {
  it('excludes already-configured providers', () => {
    render(<AddProviderPicker configuredTemplateIds={['chutes']} hasProxy={true} onPick={noop} onNeedProxy={noop} onClose={noop} />);
    expect(screen.queryByText('Chutes')).not.toBeInTheDocument();
    expect(screen.getByText('Mistral AI')).toBeInTheDocument();
  });

  it('greys proxy-providers and offers a proxy shortcut when no proxy is set', () => {
    const onNeedProxy = vi.fn();
    render(<AddProviderPicker configuredTemplateIds={[]} hasProxy={false} onPick={noop} onNeedProxy={onNeedProxy} onClose={noop} />);
    const wafer = screen.getByRole('button', { name: /wafer/i });
    expect(wafer).toBeDisabled();
    expect(screen.getAllByText(/needs a cors proxy/i).length).toBeGreaterThan(0);
    screen.getByRole('button', { name: /set up a cors proxy/i }).click();
    expect(onNeedProxy).toHaveBeenCalled();
  });

  it('enables proxy-providers when a proxy is set, and picks one', () => {
    const onPick = vi.fn();
    render(<AddProviderPicker configuredTemplateIds={[]} hasProxy={true} onPick={onPick} onNeedProxy={noop} onClose={noop} />);
    const wafer = screen.getByRole('button', { name: /wafer/i });
    expect(wafer).not.toBeDisabled();
    wafer.click();
    expect(onPick).toHaveBeenCalledWith('wafer');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/AddProviderPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `AddProviderPicker.tsx`**:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider, providerServiceKinds } from '@chatsundere/llm-unified';
import { BUILT_IN_PROVIDERS, type ProviderTemplateId } from '../lib/built-in-providers.js';
import { CapBadgeRow } from './CapBadgeRow.js';

/** Sort key: freedom-oriented first, then provider sortPriority (deredere #5). */
function rankKey(id: string): [number, number] {
  const defn = getProvider(id);
  const freedom = defn?.offerings.some((o) => o.freedomOrientedDeployment === true) ? 0 : 1;
  return [freedom, defn?.sortPriority ?? Number.MAX_SAFE_INTEGER];
}

export function AddProviderPicker({
  configuredTemplateIds,
  hasProxy,
  onPick,
  onNeedProxy,
  onClose,
}: {
  configuredTemplateIds: string[];
  hasProxy: boolean;
  onPick: (templateId: ProviderTemplateId) => void;
  onNeedProxy: () => void;
  onClose: () => void;
}): JSX.Element {
  const configured = new Set(configuredTemplateIds);
  const candidates = BUILT_IN_PROVIDERS.filter((b) => !configured.has(b.id)).sort((a, b) => {
    const [fa, pa] = rankKey(a.id);
    const [fb, pb] = rankKey(b.id);
    return fa - fb || pa - pb;
  });

  return (
    <>
      <div data-app-backdrop className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm" onClick={onClose} role="button" tabIndex={-1} aria-label="Dismiss" />
      <div data-app-sheet className="fixed inset-x-0 bottom-0 z-30 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-ink p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-sm text-paper">Add a provider</span>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1 text-paper-soft hover:text-paper">×</button>
        </div>
        <div className="flex flex-col gap-2">
          {candidates.map((b) => {
            const needsProxy = getProvider(b.id)?.corsHint === 'requires-proxy';
            const blocked = needsProxy && !hasProxy;
            return (
              <div key={b.id}>
                <button
                  type="button"
                  aria-label={b.name}
                  disabled={blocked}
                  onClick={() => !blocked && onPick(b.id)}
                  className="flex w-full items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04] disabled:opacity-50"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">{b.monogram}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-sm text-paper">{b.name}</div>
                    {blocked ? <div className="text-[11px] text-paper-soft">Needs a CORS proxy</div> : null}
                    <div className="mt-1"><CapBadgeRow lit={providerServiceKinds(b.id)} /></div>
                  </div>
                </button>
                {blocked ? (
                  <button type="button" onClick={onNeedProxy} className="mt-1 ml-13 text-[11px] text-aurora-200 underline">
                    Set up a CORS proxy →
                  </button>
                ) : null}
              </div>
            );
          })}
          {candidates.length === 0 ? (
            <p className="text-[11px] text-paper-soft">All providers are already added.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/components/AddProviderPicker.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/built-in-providers.ts apps/user-client/src/components/AddProviderPicker.tsx apps/user-client/src/components/AddProviderPicker.test.tsx
git commit -m "Add AddProviderPicker with proxy-gating and freedom-first order

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Part D — Upstream Providers rework

### Task 8: rework `settings.tsx` Upstream Providers section

**Files:**
- Modify: `apps/user-client/src/routes/app/settings.tsx`
- Test: `apps/user-client/src/routes/app/settings.providers.test.tsx` (create)

- [ ] **Step 1: Write the failing test** `settings.providers.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

let providerRows: Array<{ id: string; templateId: string; enabled: boolean }> = [];
vi.mock('../../data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));
vi.mock('../../data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null } }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@chatsundere/llm-unified', () => ({
  MODALITY_ORDER: ['llm', 'web', 'tts', 'stt', 'tti'],
  getProvider: (id: string) => ({ corsHint: 'direct', displayName: id, offerings: [{ serviceKind: 'llm' }], sortPriority: 10 }),
  providerServiceKinds: () => ['llm'],
  aggregateServiceKinds: (ids: string[]) => (ids.length ? ['llm'] : []),
  providersContributing: () => [],
}));

import { ProvidersSection } from './settings.js';

describe('Upstream Providers section', () => {
  it('shows the empty state and the proxy block when no provider is configured', () => {
    providerRows = [];
    render(<ProvidersSection />);
    expect(screen.getByText(/no voice yet/i)).toBeInTheDocument();
    expect(screen.getByText(/server connection at beta/i)).toBeInTheDocument();
  });

  it('lists only configured providers (not all built-ins)', () => {
    providerRows = [{ id: 'r1', templateId: 'chutes', enabled: true }];
    render(<ProvidersSection />);
    expect(screen.getByText('chutes')).toBeInTheDocument();
    expect(screen.queryByText('OpenRouter')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/settings.providers.test.tsx`
Expected: FAIL — `ProvidersSection` is not exported.

- [ ] **Step 3: Refactor `settings.tsx`** — replace the local `BUILT_IN_PROVIDERS`/`ProviderTemplateId`/`ProvidersList` (lines 18-29, 56-98) with an exported `ProvidersSection`. Update imports: drop the inline array (now `../../lib/built-in-providers.js`), add the new components and helpers.

```tsx
import {
  aggregateServiceKinds,
  getProvider,
  providerServiceKinds,
  providersContributing,
  type ServiceKind,
} from '@chatsundere/llm-unified';
import { AddProviderPicker } from '../../components/AddProviderPicker.js';
import { CapBadgeRow } from '../../components/CapBadgeRow.js';
import { CorsProxyBlock } from '../../components/CorsProxyBlock.js';
import { BUILT_IN_PROVIDERS, type ProviderTemplateId } from '../../lib/built-in-providers.js';
import { usableTemplateIds } from '../../lib/usable-providers.js';
// existing: ProviderSheet, useProviders, useSettings, useUpdateSettings
```

Add the exported section component:

```tsx
/** Upstream Providers: proxy block, summary, configured list, add-picker. */
export function ProvidersSection(): JSX.Element {
  const providers = useProviders();
  const settings = useSettings();
  const [openSheet, setOpenSheet] = useState<ProviderTemplateId | null>(null);
  const [picking, setPicking] = useState(false);

  const rows = providers.data ?? [];
  const hasProxy = !!settings.data?.corsProxy;
  const usable = usableTemplateIds(rows, hasProxy);
  const lit = aggregateServiceKinds(usable);

  // Greyed-badge tooltip: name an addable contributor, else "Coming soon".
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
    <div className="flex flex-col gap-3">
      <CorsProxyBlock />

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">What you have</div>
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
              onClick={() => setOpenSheet(row.templateId as ProviderTemplateId)}
              className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
            >
              <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
                {BUILT_IN_PROVIDERS.find((b) => b.id === row.templateId)?.monogram ?? row.templateId.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm text-paper">
                  {getProvider(row.templateId)?.displayName ?? row.templateId}
                </div>
                <div className="text-xs text-paper-soft">{statusOf(row)}</div>
                <div className="mt-1"><CapBadgeRow lit={providerServiceKinds(row.templateId)} /></div>
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
          onPick={(id) => { setPicking(false); setOpenSheet(id); }}
          onNeedProxy={() => { setPicking(false); /* CorsProxyBlock is in-view above */ }}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {openSheet ? <ProviderSheet templateId={openSheet} onClose={() => setOpenSheet(null)} /> : null}
    </div>
  );
}
```

Replace the accordion body usage (`settings.tsx:239`) `<ProvidersList />` with `<ProvidersSection />`, and the accordion `meta` (line 237) with `${rows configured} provider(s)` — read from `providers.data?.length`. Keep `useState` imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/settings.providers.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the existing settings test to catch regressions**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/settings.test.tsx 2>/dev/null || true` (adjust name if it exists)
Expected: PASS or no such file. Fix any reference to the removed `ProvidersList`.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/settings.tsx apps/user-client/src/routes/app/settings.providers.test.tsx
git commit -m "Rework Upstream Providers: configured-only list, summary, add-picker

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 9: slim `ProviderSheet` (proxy out, guard, post-probe flash)

**Files:**
- Modify: `apps/user-client/src/components/ProviderSheet.tsx`
- Modify: `apps/user-client/src/components/ProviderSheet.test.tsx`

- [ ] **Step 1: Update the test** — replace the "renders the proxy fields" expectation with the new contract:

```tsx
it('does not render proxy fields (proxy is global now)', () => {
  renderSheet(); // templateId="ollama-cloud"
  expect(screen.queryByLabelText(/proxy url/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/shared key/i)).not.toBeInTheDocument();
});

it('blocks save for a proxy-provider when no global proxy is set', async () => {
  // useSettings mock already returns { corsProxy: null }; ollama-cloud is requires-proxy
  renderSheet();
  screen.getByPlaceholderText('sk-...').setAttribute('value', 'k'); // see note
  screen.getByRole('button', { name: /test & save/i }).click();
  expect(await screen.findByText(/set a cors proxy first/i)).toBeInTheDocument();
});
```

Note: to drive the input value in the second test, use `fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'k' } })` (import `fireEvent` from `@testing-library/react`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/ProviderSheet.test.tsx`
Expected: FAIL — proxy fields still present / no guard.

- [ ] **Step 3: Edit `ProviderSheet.tsx`** —
  1. Delete the proxy `<div>` block (`ProviderSheet.tsx:206-252`) and the `proxyUrl`/`proxyShared` state (`:42-43`).
  2. In `onSave`, before probing a proxy-required provider, guard:

```tsx
if (requiresProxy && !settings.data?.corsProxy) {
  setStatus({ kind: 'error', reason: 'Set a CORS proxy first (My Settings → Upstream Providers)' });
  return;
}
```

  3. Replace the proxy-sealing branch (`:91-97`) — no longer seals here; read the existing global proxy for the probe:

```tsx
const sealedShared = settings.data?.corsProxy?.sharedKey ?? null;
const decryptedProxyKey =
  requiresProxy && sealedShared
    ? await openSecret(sealedShared, mk, 'cors-proxy/shared-key')
    : null;
const corsProxyUrl = requiresProxy ? (settings.data?.corsProxy?.url ?? null) : null;
```

   and pass `corsProxyUrl` / `decryptedProxyKey` into `probeProvider`. Drop `updateSettings` usage (no longer needed) — remove the `useUpdateSettings` import if unused.
  4. After `result.ok`, flash the contributed modality (deredere #4): add `const [flash, setFlash] = useState(false)` and on success `setFlash(true)` before `onClose()` is deferred — simplest: render the modality badges in the OK status line. Replace the OK branch text with:

```tsx
status.kind === 'ok' ? '✓ Key valid · LLM unlocked' : …
```

   (Today every provider is LLM; when modalities diversify, swap the literal for `providerServiceKinds(templateId).map(k=>k.toUpperCase()).join(' ')`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/components/ProviderSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/ProviderSheet.tsx apps/user-client/src/components/ProviderSheet.test.tsx
git commit -m "Slim ProviderSheet: global proxy, guard, post-probe modality flash

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Part E — Model picker

### Task 10: configured-only model list + counts + footer

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` (`ModelList`, ~lines 524-634)
- Test: `apps/user-client/src/routes/app/persona-editor.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** — add cases. First inspect the existing test's mock setup for `@chatsundere/llm-unified`; extend it so `availableCanonicals` and a multi-canonical catalogue are mockable. Add:

```tsx
it('lists only canonicals with a configured offering and hides the rest with a footer', () => {
  // configure exactly one provider that offers a subset of canonicals
  // (use the test's existing render helper for the editor with one enabled provider)
  // expect: an unavailable canonical is absent; a footer shows "+N more models"
  // (assert on the footer text via a /more models/i matcher)
});

it('counts only configured providers and badges only configured offerings', () => {
  // a canonical offered by two providers, one configured → shows "1 provider"
});
```

Implement these against the existing render harness in the file (reuse its provider/persona mocks; the harness already mounts the editor). Match its mock style for `listCanonicals`/`listOfferings`; add `availableCanonicals` to the mock returning `{ available, hiddenCount }` consistent with the configured set.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/persona-editor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Edit `ModelList`** in `persona-editor.tsx`:
  1. Import `availableCanonicals` (and keep `listOfferings`, `getProvider`).
  2. Compute the usable set from props (the editor already has `providers`): `const usable = usableTemplateIds(providers, hasProxy)` — thread `hasProxy` from `useSettings()` into `ModelList` props, or read settings in the editor and pass `configuredTemplateIds` down. Add a `configuredTemplateIds: string[]` prop to `ModelList` and pass it from the editor.
  3. Replace `listCanonicals().map((c) => …)` with:

```tsx
const { available, hiddenCount } = availableCanonicals(configuredTemplateIds);
// … available.map((c) => { … }) …
```

  4. Inside the map, filter offerings to configured before counting/badging:

```tsx
const offers = listOfferings(c.id).filter((o) => configuredByTemplate.has(o.providerId));
const teeAvailable = offers.some((o) => o.trust.tee);
const zdrAvailable = offers.some((o) => o.trust.zdr);
// provider count text uses offers.length (now configured-only)
```

  5. The inline deployment list already maps `offers` — since `offers` is now configured-only, every entry is reachable; remove the `disabled`/CTA branch (`:600`, `:618-620`) — keep only the reachable rendering.
  6. After the list, render the quiet footer:

```tsx
{hiddenCount > 0 ? (
  <button type="button" onClick={() => navigate('/app/settings')} className="mt-1 text-left text-[11px] text-paper-soft/70 hover:text-paper-soft">
    ＋{hiddenCount} more model{hiddenCount === 1 ? '' : 's'} once you add providers → My Settings
  </button>
) : null}
```

   (`navigate` via `useNavigate` already imported in the editor; if `ModelList` lacks it, pass an `onBrowseProviders` callback prop from the editor.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/persona-editor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/src/routes/app/persona-editor.test.tsx
git commit -m "Model picker: configured-only models, counts, and quiet footer

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 11: picker extras — unavailable-model row, EU badge, capability hints

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Test: `apps/user-client/src/routes/app/persona-editor.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** — add:

```tsx
it('shows a persona\'s now-unavailable model as a Currently unavailable row', () => {
  // render the editor for a persona whose canonicalId has no configured offering
  // expect: a row labelled /currently unavailable/i and a next step naming a provider
});

it('shows an EU jurisdiction badge for an EU offering', () => {
  // a configured offering with trust.jurisdiction === 'EU' → 'EU' badge present
});

it('shows Tools/Vision hints only for reachable offerings', () => {
  // a configured offering with profile.toolCalls.supported + vision → 'Tools' and 'Vision' pills
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/persona-editor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** in `persona-editor.tsx`:
  1. **Unavailable row (spec §8.1):** if `selectedCanonicalId` is set but not in `available`, render an extra row at the top of `ModelList`:

```tsx
{selectedCanonicalId && !available.some((c) => c.id === selectedCanonicalId) ? (
  (() => {
    const stale = canonicalById(selectedCanonicalId);
    const anyOffer = listOfferings(selectedCanonicalId)[0];
    const provName = anyOffer ? (getProvider(anyOffer.providerId)?.displayName ?? anyOffer.providerId) : null;
    return (
      <div className="rounded-md border border-danger/30 bg-danger/[0.04] p-3">
        <div className="font-display text-sm text-paper">{stale?.displayName ?? selectedCanonicalId}</div>
        <div className="text-xs text-danger">
          Currently unavailable{provName ? ` — add ${provName} or pick another model` : ' — pick another model'}
        </div>
      </div>
    );
  })()
) : null}
```

   Import `canonicalById`.
  2. **EU badge (deredere #3):** add a `JurisdictionBadge` next to `TrustBadge` and render it in the deployment row when `o.trust.jurisdiction === 'EU'`:

```tsx
function JurisdictionBadge({ code }: { code: string }): JSX.Element {
  return (
    <span title={`Jurisdiction: ${code}`} className="rounded border border-aurora-500/40 bg-aurora-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aurora-200">
      {code}
    </span>
  );
}
```

   In the deployment row (after the ZDR badge, ~`:614`): `{o.trust.jurisdiction ? <JurisdictionBadge code={o.trust.jurisdiction} /> : null}`.
  3. **Tools/Vision hints (deredere #6):** in the deployment row's sub-line (near the `ctx` text), add small pills only for reachable offerings (every offering here is reachable):

```tsx
<span className="flex gap-1">
  {o.profile.toolCalls.supported ? <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">Tools</span> : null}
  {o.profile.vision ? <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">Vision</span> : null}
</span>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/persona-editor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/src/routes/app/persona-editor.test.tsx
git commit -m "Model picker extras: unavailable row, EU badge, tool/vision hints

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Part F — Finalisation

### Task 12: full verification + docs

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`
- Modify: `obsidian/insights/follow-ups-index.md`

- [ ] **Step 1: Full gate**

Run, from repo root:
```bash
pnpm typecheck
cd packages/llm-unified && bun test
cd ../../apps/user-client && pnpm vitest run
cd ../.. && pnpm --filter user-client run build
```
Expected: typecheck clean; llm-unified all green; user-client green **except** the 8 known pre-existing cockpit-draft/chat-page/chat-route localStorage-jsdom failures (verify the count is unchanged — no *new* failures); build clean.

- [ ] **Step 2: Record the transitional follow-up** — append to `obsidian/insights/follow-ups-index.md`: "Remove the alpha CORS proxy (CorsProxyBlock, `SettingsRow.corsProxy`, `Needs proxy` status, `requires-proxy` client routing) when the beta proxy-service lands — spec [[../../superpowers/specs/2026-05-31-provider-model-handling-rework-design]] §13."

- [ ] **Step 3: Update STATUS** — add a top entry to `STATUS-CLIENT-ONLY.md` summarising the rework (derived modality caps, global proxy home, add-picker, configured-only model picker, deredere extras), note "not pushed", update `Last updated:`.

- [ ] **Step 4: Commit docs**

```bash
git add obsidian/STATUS-CLIENT-ONLY.md obsidian/insights/follow-ups-index.md
git commit -m "Record provider/model rework in STATUS and follow-ups [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand back to Liz for the manual-verification + squash** — do NOT squash, merge, or push (subagents never do — CLAUDE.md §13). Report the 7 manual-verification steps from spec §12 for Chris's device test. Liz squashes the 12 checkpoint commits into one feature commit after Chris signs off.

---

## Self-review notes (author)

- **Spec coverage:** §4 → T1-3; §5.A → T6; §5.B → T5,T8; §5.C → T8; §5.D → T7; §5.E → T8; §6 → T9; §7 → T10,T11; §8.1 → T11; §8.2 → T6; §9 extras 1-6 → T7(#1,#5), T8(#2), T9(#4), T11(#3,#6); §10 taxonomy → T1,T5; §13 → T12. All covered.
- **Type consistency:** `ServiceKind`, `MODALITY_ORDER`, `providerServiceKinds`, `aggregateServiceKinds`, `providersContributing`, `availableCanonicals`, `usableTemplateIds`, `BUILT_IN_PROVIDERS`/`ProviderTemplateId` named identically across tasks.
- **No Dexie migration** — confirmed; only derived state added.
- **Larissa** — not triggered (no auth/sync/proxy-service/crypto path).
