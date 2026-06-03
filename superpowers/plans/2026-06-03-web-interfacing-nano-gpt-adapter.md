# Web Interfacing — nano-gpt Adapter & Go-Live — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the dormant web-interfacing spine live via nano-gpt search (`/api/web`) + fetch (`/scrape-urls`) adapters, three curated offerings (Linkup default, Exa, Brave), auto-default-on, a cockpit depth control, and systematic `requires-proxy` wiring.

**Architecture:** A nano-gpt web adapter reuses the existing `buildRequest` transport primitive (`ProviderConfig = {baseUrl, routing}` already serves as the route target) and routes through the user's CORS proxy because the web endpoints send no CORS headers (measured). Proxy requirement is modelled as data (`WebOfferingMeta.requiresProxy`), decoupled from nano-gpt's chat `corsHint`. Search depth is a per-offering curated `searchTiers` list, user-selected in the cockpit, defaulting to the cheapest tier.

**Tech Stack:** TypeScript (strict), Bun test runner (llm-unified), Vitest (user-client), Drizzle/Dexie, React 18.

**Spec:** `superpowers/specs/2026-06-03-web-interfacing-nano-gpt-adapter-design.md`

**Larissa:** not triggered (llm-unified + user-client only; no auth/sync/proxy-service/crypto). Task 14 logs the outbound surface in `obsidian/insights/security-deferrals.md`.

---

## File structure

**Create:**
- `packages/llm-unified/src/web-adapters/nano-gpt-web.ts` — the search + fetch adapters
- `packages/llm-unified/src/web-adapters/nano-gpt-web.test.ts` — adapter unit tests
- `apps/user-client/src/lib/web-search-resolver.ts` — tier selection → `WebSearchOpts` (mirrors `reasoning-resolver.ts`)
- `apps/user-client/src/lib/web-search-resolver.test.ts`
- `apps/user-client/src/lib/web-backends.ts` — `resolveWebBackend` (unset → default / off → null / ref)
- `apps/user-client/src/lib/web-backends.test.ts`

**Modify:**
- `packages/llm-unified/src/integrations/web-interfacing.ts` — contract changes (traits, tiers, opts, proxy in `WebContext`, drop `qualityClass`)
- `packages/llm-unified/src/index.ts` — barrel exports
- `packages/llm-unified/src/providers/nano-gpt.ts` — curate web offerings + register web adapters
- `packages/llm-unified/src/providers/builtins.test.ts` — assert the web offerings
- `apps/user-client/src/integrations/types.ts` — `IntegrationContext` += proxy + tier
- `apps/user-client/src/integrations/build-context.ts` — thread proxy + tier
- `apps/user-client/src/integrations/web/web-integration.ts` — pass opts, try/catch, gate on proxy
- `apps/user-client/src/lib/web-backend-options.ts` — `qualityClass` → `traits`
- `apps/user-client/src/components/WebInterfacingSection.tsx` — trait badges + Off option + ZK line
- `apps/user-client/src/routes/app/settings.tsx` — resolved default + corsProxy gating
- `apps/user-client/src/state/current-chat.store.ts` — `webSearchTierId` slice
- `apps/user-client/src/state/stream-manager.store.ts` — thread proxy + tier into context
- `apps/user-client/src/components/chat/CockpitMenu.tsx` — depth section
- `apps/user-client/src/components/chat/Cockpit.tsx` — thread search tiers
- `apps/user-client/src/components/chat/chat-page.tsx` (or the Cockpit's parent) — resolve active web search offering tiers

**No Dexie migration:** `settings.webInterfacing` is non-indexed; `null` already seeded by v11 is reinterpreted as "unset → default". Only the TS type widens (`OfferingRef | 'off' | null`).

---

## Phase A — llm-unified contract + adapter

### Task 1: Extend the web-interfacing contract

**Files:**
- Modify: `packages/llm-unified/src/integrations/web-interfacing.ts`
- Modify: `packages/llm-unified/src/index.ts`

- [ ] **Step 1: Edit `web-interfacing.ts`** — add proxy fields to `WebContext`, replace `WebQualityClass`/`qualityClass` with traits, add `SearchTier`/`WebSearchOpts`, extend `search` signature.

Replace the `WebContext`, `WebQualityClass`, `WebOfferingMeta`, and `WebInterfacingProvider` declarations with:

```typescript
/** The per-call context a web backend may use: NSFW permission, an optional
 *  location hint, and the call-time CORS-proxy routing (null when the adapter
 *  is allowed direct, e.g. the Bun live-suite; populated in the browser). */
export interface WebContext {
  nsfwAllowed: boolean;
  location: WebLocation | null;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
}

/** A curated display trait for a web backend, shown as a badge in the backend
 *  picker. `ai` replaces the old `ai-friendly` quality class; Brave is
 *  human-oriented and carries `privacy` instead. */
export type WebTrait = 'recommended' | 'ai' | 'neural' | 'privacy';

/** One curated search-depth tier surfaced in the cockpit. The first tier in an
 *  offering's list is the default (cheapest). `params` are merged verbatim into
 *  the search request body. `label`/`tooltip` are user-facing British English. */
export interface SearchTier {
  id: string;
  label: string;
  tooltip?: string;
  params: { depth?: string; numResults?: number };
}

/** Resolved per-call search options (a tier's `params`). */
export type WebSearchOpts = { depth?: string; numResults?: number };

/** Curated capability metadata for a `web` offering. */
export interface WebOfferingMeta {
  canSearch: boolean;
  canFetch: boolean;
  traits: WebTrait[];
  /** True when the backend's endpoints send no CORS headers and must route
   *  through the user's CORS proxy (all nano-gpt web endpoints today). */
  requiresProxy: boolean;
  /** Search-only: the curated depth tiers (first = default). Omitted for fetch. */
  searchTiers?: SearchTier[];
}

/** Behavioural contract a web-interfacing adapter implements. */
export interface WebInterfacingProvider {
  search?(
    query: string,
    ctx: WebContext,
    key: string,
    opts: WebSearchOpts,
    signal?: AbortSignal,
  ): Promise<WebSearchResult>;
  fetch?(url: string, ctx: WebContext, key: string, signal?: AbortSignal): Promise<WebFetchResult>;
}
```

Also delete the now-unused `WebQualityClass` type and update the `WebFetchResult` doc comment to drop the `ai-friendly`/`classic` reference (replace with: `content` is model-ready text, markdown when available).

- [ ] **Step 2: Edit `index.ts` barrel** — replace the `WebQualityClass` export with `WebTrait`, `SearchTier`, `WebSearchOpts`.

In the `export type { … } from './integrations/web-interfacing.js';` block, remove `WebQualityClass` and add `WebTrait, SearchTier, WebSearchOpts`.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter @chatsundere/llm-unified exec tsc --noEmit`
Expected: errors only in downstream files that still reference `qualityClass` (fixed in Tasks 4, 6) — none inside `web-interfacing.ts`/`index.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/llm-unified/src/integrations/web-interfacing.ts packages/llm-unified/src/index.ts
git commit -m "Extend web-interfacing contract: traits, search tiers, proxy ctx"
```

---

### Task 2: nano-gpt web search adapter

**Files:**
- Create: `packages/llm-unified/src/web-adapters/nano-gpt-web.ts`
- Test: `packages/llm-unified/src/web-adapters/nano-gpt-web.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { WebContext } from '../integrations/web-interfacing.js';
import { nanoGptWebSearchAdapter } from './nano-gpt-web.js';

const directCtx: WebContext = {
  nsfwAllowed: false,
  location: null,
  corsProxyUrl: null,
  corsProxyKey: null,
};

describe('nanoGptWebSearchAdapter', () => {
  it('maps /api/web data[] to ranked hits and sends provider + opts (direct)', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(
        JSON.stringify({
          data: [
            { type: 'text', title: 'Bun', url: 'https://bun.com', content: 'fast runtime' },
            { type: 'text', title: 'GitHub', url: 'https://github.com/oven-sh/bun', content: 'repo' },
          ],
          metadata: { cost: 0.005 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = nanoGptWebSearchAdapter('exa', fakeFetch as typeof fetch);
    const result = await adapter.search!('latest bun', directCtx, 'KEY', {
      depth: 'neural',
      numResults: 8,
    });

    expect(result.query).toBe('latest bun');
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toEqual({ title: 'Bun', url: 'https://bun.com', snippet: 'fast runtime' });

    // direct routing → URL is the upstream, Bearer key set
    expect(captured!.url).toBe('https://nano-gpt.com/api/web');
    expect(captured!.headers.get('authorization')).toBe('Bearer KEY');
    const body = JSON.parse(await captured!.text());
    expect(body).toMatchObject({
      query: 'latest bun',
      provider: 'exa',
      depth: 'neural',
      numResults: 8,
      outputType: 'searchResults',
    });
  });

  it('routes through the cors-proxy when configured', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(JSON.stringify({ data: [], metadata: {} }), { status: 200 });
    };
    const adapter = nanoGptWebSearchAdapter('linkup', fakeFetch as typeof fetch);
    await adapter.search!('q', { ...directCtx, corsProxyUrl: 'https://proxy.example', corsProxyKey: 'P' }, 'KEY', {});

    expect(captured!.url).toBe('https://proxy.example/web');
    expect(captured!.headers.get('x-cors-proxy-api-key')).toBe('P');
    expect(captured!.headers.get('x-cors-proxy-target')).toBe('https://nano-gpt.com/api');
  });

  it('caps each snippet to bound tool output', async () => {
    const long = 'x'.repeat(2000);
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ data: [{ type: 'text', title: 't', url: 'u', content: long }] }), {
        status: 200,
      });
    const adapter = nanoGptWebSearchAdapter('brave', fakeFetch as typeof fetch);
    const r = await adapter.search!('q', directCtx, 'K', {});
    expect(r.hits[0]!.snippet.length).toBeLessThanOrEqual(600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/llm-unified exec bun test src/web-adapters/nano-gpt-web.test.ts`
Expected: FAIL — `Cannot find module './nano-gpt-web.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type {
  WebContext,
  WebFetchResult,
  WebInterfacingProvider,
  WebSearchOpts,
  WebSearchResult,
} from '../integrations/web-interfacing.js';
import type { ProviderConfig } from '../types.js';
import { buildRequest } from '../transport.js';

/** Web endpoints live under `/api` (not `/api/v1`, which is the chat path). */
const WEB_BASE_URL = 'https://nano-gpt.com/api';
const SNIPPET_CAP = 600;

/** Build the route target: cors-proxy when a proxy is configured (the browser),
 *  direct otherwise (the Bun live-suite, where CORS is irrelevant). */
function routeFor(ctx: WebContext): ProviderConfig {
  return {
    baseUrl: WEB_BASE_URL,
    routing: ctx.corsProxyUrl ? { kind: 'cors-proxy' } : { kind: 'direct' },
  };
}

async function postWeb(
  ctx: WebContext,
  key: string,
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const req = buildRequest({
    provider: routeFor(ctx),
    apiKey: key,
    corsProxyUrl: ctx.corsProxyUrl,
    corsProxyKey: ctx.corsProxyKey,
    path,
    method: 'POST',
    body,
  });
  const res = await fetchImpl(signal ? new Request(req, { signal }) : req);
  if (!res.ok) {
    throw new Error(`nano-gpt web ${path} failed: HTTP ${res.status}`);
  }
  return res.json();
}

interface WebSearchPayload {
  data?: Array<{ title?: string; url?: string; content?: string }>;
}

/** Search adapter bound to one nano-gpt search provider (linkup | exa | brave).
 *  `fetchImpl` is injectable for tests. */
export function nanoGptWebSearchAdapter(
  provider: 'linkup' | 'exa' | 'brave',
  fetchImpl: typeof fetch = fetch,
): WebInterfacingProvider {
  return {
    async search(
      query: string,
      ctx: WebContext,
      key: string,
      opts: WebSearchOpts,
      signal?: AbortSignal,
    ): Promise<WebSearchResult> {
      const body = { query, provider, outputType: 'searchResults', ...opts };
      const payload = (await postWeb(ctx, key, '/web', body, fetchImpl, signal)) as WebSearchPayload;
      const hits = (payload.data ?? []).map((d) => ({
        title: d.title ?? '',
        url: d.url ?? '',
        snippet: (d.content ?? '').slice(0, SNIPPET_CAP),
      }));
      return { query, hits };
    },
  };
}

interface WebScrapePayload {
  results?: Array<{ url?: string; success?: boolean; markdown?: string; content?: string }>;
}

/** Fetch (scrape) adapter using nano-gpt's standalone `/scrape-urls`. */
export function nanoGptWebScrapeAdapter(fetchImpl: typeof fetch = fetch): WebInterfacingProvider {
  return {
    async fetch(
      url: string,
      ctx: WebContext,
      key: string,
      signal?: AbortSignal,
    ): Promise<WebFetchResult> {
      const payload = (await postWeb(
        ctx,
        key,
        '/scrape-urls',
        { urls: [url] },
        fetchImpl,
        signal,
      )) as WebScrapePayload;
      const first = payload.results?.[0];
      if (!first || first.success === false) {
        throw new Error(`Could not fetch ${url}.`);
      }
      return { url, content: first.markdown ?? first.content ?? '' };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/llm-unified exec bun test src/web-adapters/nano-gpt-web.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/web-adapters/nano-gpt-web.ts packages/llm-unified/src/web-adapters/nano-gpt-web.test.ts
git commit -m "Add nano-gpt web search + scrape adapters"
```

---

### Task 3: Fetch-adapter test coverage

**Files:**
- Modify: `packages/llm-unified/src/web-adapters/nano-gpt-web.test.ts`

- [ ] **Step 1: Add failing tests for the scrape adapter**

```typescript
import { nanoGptWebScrapeAdapter } from './nano-gpt-web.js';

describe('nanoGptWebScrapeAdapter', () => {
  it('prefers markdown and posts {urls:[url]} to /scrape-urls', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(
        JSON.stringify({ results: [{ url: 'u', success: true, markdown: '# md', content: 'plain' }] }),
        { status: 200 },
      );
    };
    const adapter = nanoGptWebScrapeAdapter(fakeFetch as typeof fetch);
    const r = await adapter.fetch!('https://x', directCtx, 'K');
    expect(r).toEqual({ url: 'https://x', content: '# md' });
    const body = JSON.parse(await captured!.text());
    expect(body).toEqual({ urls: ['https://x'] });
    expect(captured!.url).toBe('https://nano-gpt.com/api/scrape-urls');
  });

  it('throws a constructive error on failed scrape', async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ results: [{ url: 'u', success: false }] }), { status: 200 });
    const adapter = nanoGptWebScrapeAdapter(fakeFetch as typeof fetch);
    await expect(adapter.fetch!('https://x', directCtx, 'K')).rejects.toThrow(/Could not fetch/);
  });
});
```

- [ ] **Step 2: Run — verify pass** (implementation already exists from Task 2)

Run: `pnpm --filter @chatsundere/llm-unified exec bun test src/web-adapters/nano-gpt-web.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/src/web-adapters/nano-gpt-web.test.ts
git commit -m "Cover nano-gpt scrape adapter (markdown preference, failure)"
```

---

### Task 4: Curate the web offerings + register adapters

**Files:**
- Modify: `packages/llm-unified/src/providers/nano-gpt.ts`
- Modify: `packages/llm-unified/src/providers/builtins.test.ts`

- [ ] **Step 1: Write the failing assertion in `builtins.test.ts`**

```typescript
it('nano-gpt has 3 web search offerings + 1 fetch offering with traits/tiers', () => {
  const p = getProvider('nano-gpt');
  const web = (p?.offerings ?? []).filter((o) => o.serviceKind === 'web');
  expect(web).toHaveLength(4);

  const linkup = web.find((o) => o.upstreamSlug === 'web-linkup');
  expect(linkup?.web?.canSearch).toBe(true);
  expect(linkup?.web?.requiresProxy).toBe(true);
  expect(linkup?.web?.traits).toEqual(['recommended', 'ai']);
  expect(linkup?.web?.searchTiers?.[0]?.id).toBe('standard');

  const exa = web.find((o) => o.upstreamSlug === 'web-exa');
  expect(exa?.web?.traits).toEqual(['ai', 'neural']);
  expect(exa?.web?.searchTiers?.map((t) => t.id)).toEqual(['quick', 'neural']);

  const brave = web.find((o) => o.upstreamSlug === 'web-brave');
  expect(brave?.web?.traits).toEqual(['privacy']);

  const scrape = web.find((o) => o.upstreamSlug === 'web-scrape');
  expect(scrape?.web?.canFetch).toBe(true);
  expect(scrape?.web?.canSearch).toBe(false);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @chatsundere/llm-unified exec bun test src/providers/builtins.test.ts -t "web search offerings"`
Expected: FAIL — `web` has length 0.

- [ ] **Step 3: Add the web offerings + adapter registration in `nano-gpt.ts`**

Add near the other offering helpers (define `webOffering` and the four entries), append them to the exported `offerings` array, and register the web adapters in `registerNanoGpt`.

```typescript
import {
  registerWebAdapter,
  type SearchTier,
  type WebOfferingMeta,
} from '../index.js'; // or the direct module paths used elsewhere in this file
import { nanoGptWebScrapeAdapter, nanoGptWebSearchAdapter } from '../web-adapters/nano-gpt-web.js';

const EXA_TIERS: SearchTier[] = [
  { id: 'quick', label: 'Quick', params: { depth: 'auto', numResults: 8 } },
  { id: 'neural', label: 'Neural', tooltip: 'semantic search', params: { depth: 'neural', numResults: 8 } },
];
const LINKUP_TIERS: SearchTier[] = [
  { id: 'standard', label: 'Standard', params: { depth: 'standard' } },
  { id: 'deep', label: 'Deep', tooltip: 'slower, ~10× the cost', params: { depth: 'deep' } },
];
const BRAVE_TIERS: SearchTier[] = [{ id: 'standard', label: 'Standard', params: { depth: 'standard' } }];

function webSearchOffering(slug: string, meta: WebOfferingMeta): Offering {
  return {
    canonicalRef: null,
    providerId: 'nano-gpt',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `nano-gpt:${slug}` },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'web',
    web: meta,
  };
}

const webOfferings: Offering[] = [
  webSearchOffering('web-linkup', {
    canSearch: true,
    canFetch: false,
    requiresProxy: true,
    traits: ['recommended', 'ai'],
    searchTiers: LINKUP_TIERS,
  }),
  webSearchOffering('web-exa', {
    canSearch: true,
    canFetch: false,
    requiresProxy: true,
    traits: ['ai', 'neural'],
    searchTiers: EXA_TIERS,
  }),
  webSearchOffering('web-brave', {
    canSearch: true,
    canFetch: false,
    requiresProxy: true,
    traits: ['privacy'],
    searchTiers: BRAVE_TIERS,
  }),
  webSearchOffering('web-scrape', {
    canSearch: false,
    canFetch: true,
    requiresProxy: true,
    traits: [],
  }),
];
```

> If `ModelProfile` requires fields not shown above (e.g. an exact `reasoning` shape), copy the minimal shape from an existing `llm` offering in this file and set reasoning to its `none`/off form. The point is a structurally valid `Offering` whose `serviceKind` is `web`.

Append `...webOfferings` to the `offerings` array. Then, inside `registerNanoGpt()`, after the existing loop, register the web adapters:

```typescript
  const searchProviderBySlug: Record<string, 'linkup' | 'exa' | 'brave'> = {
    'web-linkup': 'linkup',
    'web-exa': 'exa',
    'web-brave': 'brave',
  };
  for (const o of webOfferings) {
    if (o.adapter.kind !== 'catalogue') continue;
    if (o.web?.canFetch) {
      registerWebAdapter(o.adapter.adapterId, () => nanoGptWebScrapeAdapter());
    } else {
      const sp = searchProviderBySlug[o.upstreamSlug];
      if (sp) registerWebAdapter(o.adapter.adapterId, () => nanoGptWebSearchAdapter(sp));
    }
  }
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm --filter @chatsundere/llm-unified exec bun test src/providers/builtins.test.ts`
Expected: PASS (existing + the new web assertion).

- [ ] **Step 5: Full llm-unified suite + typecheck**

Run: `pnpm --filter @chatsundere/llm-unified exec bun test` then `pnpm typecheck`
Expected: green (the known `canonical-registry` double-registration flake aside — verify identical on master if it appears).

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/providers/nano-gpt.ts packages/llm-unified/src/providers/builtins.test.ts
git commit -m "Curate nano-gpt web offerings (linkup/exa/brave + scrape) and register adapters"
```

---

## Phase B — client wiring (search/fetch live at default tier)

### Task 5: Migrate `web-backend-options` from qualityClass to traits

**Files:**
- Modify: `apps/user-client/src/lib/web-backend-options.ts`
- Test: `apps/user-client/src/lib/web-backend-options.test.ts` (create if absent)

- [ ] **Step 1: Write/adjust the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import type { ProviderDefinition } from '@chatsundere/llm-unified';
import { webBackendOptions } from './web-backend-options.js';

const fake = (): ProviderDefinition =>
  ({
    id: 'nano-gpt',
    displayName: 'nano-gpt',
    offerings: [
      {
        providerId: 'nano-gpt',
        upstreamSlug: 'web-exa',
        serviceKind: 'web',
        web: { canSearch: true, canFetch: false, requiresProxy: true, traits: ['ai', 'neural'] },
      },
    ],
  }) as unknown as ProviderDefinition;

describe('webBackendOptions', () => {
  it('surfaces traits and requiresProxy', () => {
    const opts = webBackendOptions(['nano-gpt'], fake);
    expect(opts[0]).toMatchObject({
      providerId: 'nano-gpt',
      upstreamSlug: 'web-exa',
      canSearch: true,
      traits: ['ai', 'neural'],
      requiresProxy: true,
    });
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/web-backend-options.test.ts`
Expected: FAIL — `traits` undefined on the option.

- [ ] **Step 3: Update `WebBackendOption` + the mapping**

Replace `qualityClass: 'classic' | 'ai-friendly'` on `WebBackendOption` with:

```typescript
  traits: WebTrait[];
  requiresProxy: boolean;
```

(import `WebTrait` from `@chatsundere/llm-unified`), and in the loop replace `qualityClass: o.web.qualityClass` with `traits: o.web.traits, requiresProxy: o.web.requiresProxy`.

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/web-backend-options.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/web-backend-options.ts apps/user-client/src/lib/web-backend-options.test.ts
git commit -m "web-backend-options: surface traits + requiresProxy"
```

---

### Task 6: `resolveWebBackend` (unset → default / off → null / ref)

**Files:**
- Create: `apps/user-client/src/lib/web-backends.ts`
- Test: `apps/user-client/src/lib/web-backends.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { resolveWebBackend, type WebBackendSetting } from './web-backends.js';
import type { WebBackendOption } from './web-backend-options.js';

const opt = (slug: string, canSearch = true): WebBackendOption => ({
  providerId: 'nano-gpt',
  providerName: 'nano-gpt',
  upstreamSlug: slug,
  canSearch,
  canFetch: !canSearch,
  traits: [],
  requiresProxy: true,
});

const search = [opt('web-linkup'), opt('web-exa')];

describe('resolveWebBackend', () => {
  it('unset (null) → the recommended default (first option) when available', () => {
    expect(resolveWebBackend(null, search, 'search')).toEqual({
      providerId: 'nano-gpt',
      upstreamSlug: 'web-linkup',
    });
  });
  it("explicit 'off' → null", () => {
    expect(resolveWebBackend('off', search, 'search')).toBeNull();
  });
  it('an explicit ref → itself when still available', () => {
    const ref = { providerId: 'nano-gpt', upstreamSlug: 'web-exa' };
    expect(resolveWebBackend(ref, search, 'search')).toEqual(ref);
  });
  it('an explicit ref → null when no longer available', () => {
    const ref = { providerId: 'nano-gpt', upstreamSlug: 'web-gone' };
    expect(resolveWebBackend(ref, search, 'search')).toBeNull();
  });
  it('unset with no options → null', () => {
    expect(resolveWebBackend(null, [], 'search')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/web-backends.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { OfferingRef } from '../integrations/types.js';
import type { WebBackendOption } from './web-backend-options.js';

/** Stored web-backend setting: an explicit ref, explicit `'off'`, or `null` =
 *  unset (→ recommended default once the modality is available). */
export type WebBackendSetting = OfferingRef | 'off' | null;

const canRole = (o: WebBackendOption, role: 'search' | 'fetch'): boolean =>
  role === 'search' ? o.canSearch : o.canFetch;

const refOf = (o: WebBackendOption): OfferingRef => ({
  providerId: o.providerId,
  upstreamSlug: o.upstreamSlug,
});

/** Resolve a stored setting against the currently available options into the
 *  effective backend (`null` = off / unavailable). The recommended default is
 *  the first option that can serve the role (offerings are freedom-first
 *  ordered, with Linkup first for search). */
export function resolveWebBackend(
  setting: WebBackendSetting,
  options: WebBackendOption[],
  role: 'search' | 'fetch',
): OfferingRef | null {
  const usable = options.filter((o) => canRole(o, role));
  if (setting === 'off') return null;
  if (setting === null) return usable[0] ? refOf(usable[0]) : null;
  const match = usable.find(
    (o) => o.providerId === setting.providerId && o.upstreamSlug === setting.upstreamSlug,
  );
  return match ? refOf(match) : null;
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/web-backends.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/web-backends.ts apps/user-client/src/lib/web-backends.test.ts
git commit -m "Add resolveWebBackend (unset→default, off→null, ref-validate)"
```

---

### Task 7: Thread proxy + tier through the integration context

**Files:**
- Modify: `apps/user-client/src/integrations/types.ts`
- Modify: `apps/user-client/src/integrations/build-context.ts`
- Modify: `apps/user-client/src/integrations/web/web-integration.ts`

- [ ] **Step 1: Extend `IntegrationContext`** (`integrations/types.ts`)

Add to the interface:

```typescript
  /** Call-time CORS proxy (the LLM path's decrypted corsProxy), or null. */
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  /** The cockpit-selected search tier id, or null (→ the offering's default). */
  webSearchTierId: string | null;
```

- [ ] **Step 2: Extend `buildIntegrationContext`** (`integrations/build-context.ts`)

Change the signature to take a `route` options object and populate the new fields. Replace the function with:

```typescript
export interface IntegrationRoute {
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  webSearchTierId: string | null;
}

export function buildIntegrationContext(
  persona: PersonaNsfw,
  web: WebSettings,
  mk: MasterKey | null,
  route: IntegrationRoute,
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
    getKey: (id) => (mk ? getKeyFn(id, mk) : Promise.resolve(null)),
  };
}
```

- [ ] **Step 3: Update `web-integration.ts`** — pass proxy via `toWebContext`, resolve the tier, pass `opts`, gate on proxy, wrap in try/catch (constructive error).

Replace `toWebContext`:

```typescript
function toWebContext(ctx: IntegrationContext): WebContext {
  return {
    nsfwAllowed: ctx.nsfwAllowed,
    location: ctx.location,
    corsProxyUrl: ctx.corsProxyUrl,
    corsProxyKey: ctx.corsProxyKey,
  };
}
```

In `resolve()`, after resolving the offering, add the proxy gate:

```typescript
    if (offering.web.requiresProxy && !ctx.corsProxyUrl) return null;
```

(the `ctx` is in scope via the closure — `resolve` already closes over the integration's `contributesTools(ctx)`; pass `ctx` into `resolve` if it currently does not — adjust `resolve` to `(ref, ctx)` and update both call sites).

In the `web_search` `execute`, resolve the tier and pass opts, wrapped:

```typescript
          async execute(args, signal): Promise<ToolResult> {
            try {
              const key = await ctx.getKey(offering.providerId);
              if (!key) return { ok: false, output: '', error: 'No API key for the web search backend.' };
              const query = typeof args.query === 'string' ? args.query : '';
              const tiers = offering.web?.searchTiers ?? [];
              const tier = tiers.find((t) => t.id === ctx.webSearchTierId) ?? tiers[0];
              const opts = tier?.params ?? {};
              const result = await provider.search!(query, toWebContext(ctx), key, opts, signal);
              return { ok: true, output: formatSearch(result), error: null };
            } catch (e) {
              return { ok: false, output: '', error: e instanceof Error ? e.message : 'Web search failed.' };
            }
          },
```

Wrap the `web_fetch` `execute` body in the same try/catch shape (key check → `provider.fetch!(url, toWebContext(ctx), key, signal)` → constructive error). Update the two tool `description` strings to the spec's British-English copy (§5.7).

- [ ] **Step 4: Run the existing web-integration tests + typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/integrations` then `pnpm typecheck`
Expected: the existing integration tests need their `buildIntegrationContext` / `WebContext` call sites updated for the new args — update those test fixtures (add `corsProxyUrl/Key/webSearchTierId`, the `route` arg). Then green.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/integrations
git commit -m "Thread CORS proxy + search tier through the integration context"
```

---

### Task 8: Wire proxy + tier + resolved backends at send time

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Modify: `apps/user-client/src/state/current-chat.store.ts`

- [ ] **Step 1: Add the `webSearchTierId` slice** (`current-chat.store.ts`)

Add to the state interface, the actions, and initial state (mirroring `reasoning`):

```typescript
  webSearchTierId: string | null;     // interface
  setWebSearchTierId: (id: string | null) => void;   // interface
...
  webSearchTierId: null,              // initial state
...
  setWebSearchTierId: (id) => set({ webSearchTierId: id }),  // action
```

- [ ] **Step 2: Update the `buildIntegrationContext` call** (`stream-manager.store.ts`, ~line 224)

Resolve the backends + read proxy + tier. The proxy values already flow to the streaming call (`args.corsProxyUrl`/`args.corsProxyKey` — the same ones `send-message.ts` computes and `stream-completion` consumes); reuse them. Replace the call block with:

```typescript
  const wi = args.webInterfacing ?? { search: null, fetch: null };
  const integrationCtx = buildIntegrationContext(
    args.persona,
    wi,
    useSessionStore.getState().mk,
    {
      corsProxyUrl: args.corsProxyUrl ?? null,
      corsProxyKey: args.corsProxyKey ?? null,
      webSearchTierId: useCurrentChatStore.getState().webSearchTierId,
    },
  );
```

> `args.webInterfacing.search`/`.fetch` are already the **resolved** `OfferingRef | null` (resolution happens in `send-message.ts`, Task 9). If `args` does not yet carry `corsProxyUrl`/`corsProxyKey`, thread them from `send-message.ts` where they are computed (verbatim in the spec) into this store's `args` type.

- [ ] **Step 3: Typecheck + run the stream-manager store tests**

Run: `pnpm typecheck` then `pnpm --filter @chatsundere/user-client exec vitest run src/state/stream-manager-store.test.ts`
Expected: update any test stub that builds `args` to include `corsProxyUrl`/`corsProxyKey`/`webInterfacing`; then green.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/state/current-chat.store.ts apps/user-client/src/state/stream-manager.store.ts
git commit -m "Wire proxy + selected search tier into the per-send integration context"
```

---

### Task 9: Resolve backends in send-message + pass through

**Files:**
- Modify: `apps/user-client/src/lib/send-message.ts` (and the store args type it feeds)

- [ ] **Step 1: Resolve the stored setting into effective refs**

Where `send-message.ts` assembles the streaming args (it already computes `corsProxyUrl`/`corsProxyKey`), resolve the stored `settings.webInterfacing` into effective `OfferingRef | null` via `resolveWebBackend`, and pass `webInterfacing: { search, fetch }` plus `corsProxyUrl`/`corsProxyKey` into the stream-manager `start`/`regenerate` args:

```typescript
import { resolveWebBackend } from './web-backends.js';
import { webBackendOptions } from './web-backend-options.js';
...
  const webOptions = webBackendOptions(usableTemplateIds); // same usable ids the settings UI uses
  const webInterfacing = {
    search: resolveWebBackend(settings.webInterfacing?.search ?? null, webOptions, 'search'),
    fetch: resolveWebBackend(settings.webInterfacing?.fetch ?? null, webOptions, 'fetch'),
  };
```

> `settings.webInterfacing.search`/`.fetch` are now typed `WebBackendSetting` (Task 10). The list of `usableTemplateIds` is the same set the settings screen passes to `webBackendOptions`; reuse the existing helper that produces it (`useUsableTemplateIds` has a non-hook equivalent, or compute from enabled providers as that hook does).

- [ ] **Step 2: Typecheck + manual reasoning** (no isolated unit; covered e2e by stream-manager tests + manual verification)

Run: `pnpm typecheck`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/send-message.ts
git commit -m "Resolve web backends (auto-default Linkup) at send time"
```

---

### Task 10: Settings UI — trait badges, Off option, ZK line, default selection

**Files:**
- Modify: `apps/user-client/src/components/WebInterfacingSection.tsx`
- Modify: `apps/user-client/src/routes/app/settings.tsx`
- Modify: `apps/user-client/src/boot/client-data-db.ts` (widen the type only)

- [ ] **Step 1: Widen the settings type** (`client-data-db.ts`)

Change `webInterfacing: { search: OfferingRef | null; fetch: OfferingRef | null }` to use `WebBackendSetting`:

```typescript
  webInterfacing: { search: WebBackendSetting; fetch: WebBackendSetting };
```

(import `WebBackendSetting` from `../lib/web-backends.js`). The v11 seed `{ search: null, fetch: null }` is unchanged (now means "unset → default"). **No new Dexie version** — the field is non-indexed.

- [ ] **Step 2: Rewrite `WebInterfacingSection`** — trait badges, an explicit "Off" option, resolved default selection, ZK info line.

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { WebTrait } from '@chatsundere/llm-unified';
import type { WebBackendSetting } from '../lib/web-backends.js';
import { resolveWebBackend } from '../lib/web-backends.js';
import type { WebBackendOption } from '../lib/web-backend-options.js';

interface WebInterfacingValue {
  search: WebBackendSetting;
  fetch: WebBackendSetting;
}
interface Props {
  options: WebBackendOption[];
  search: WebBackendSetting;
  fetch: WebBackendSetting;
  onChange: (next: WebInterfacingValue) => void;
}

const TRAIT_LABEL: Record<WebTrait, string> = {
  recommended: 'Recommended',
  ai: 'AI',
  neural: 'Neural',
  privacy: 'Privacy',
};
const keyOf = (o: { providerId: string; upstreamSlug: string }): string =>
  `${o.providerId}::${o.upstreamSlug}`;

// Picker value encoding: '' = Off (explicit), 'unset' = use default, else the key.
function settingToValue(s: WebBackendSetting): string {
  if (s === 'off') return '';
  if (s === null) return 'unset';
  return keyOf(s);
}
function valueToSetting(v: string): WebBackendSetting {
  if (v === '') return 'off';
  if (v === 'unset') return null;
  const [providerId, upstreamSlug] = v.split('::');
  return providerId && upstreamSlug ? { providerId, upstreamSlug } : null;
}

function Picker({
  id,
  role,
  options,
  setting,
  onChange,
}: {
  id: string;
  role: 'search' | 'fetch';
  options: WebBackendOption[];
  setting: WebBackendSetting;
  onChange: (s: WebBackendSetting) => void;
}): JSX.Element {
  const effective = resolveWebBackend(setting, options, role);
  const can = (o: WebBackendOption) => (role === 'search' ? o.canSearch : o.canFetch);
  return (
    <div className="web-picker">
      <select id={id} value={settingToValue(setting)} onChange={(e) => onChange(valueToSetting(e.target.value))}>
        <option value="unset">Default</option>
        <option value="">Off</option>
        {options.map((o) => (
          <option key={keyOf(o)} value={keyOf(o)} disabled={!can(o)}>
            {o.providerName} · {o.upstreamSlug}
          </option>
        ))}
      </select>
      {/* trait badges for the effective backend */}
      <span className="web-traits">
        {effective
          ? options
              .find((o) => o.providerId === effective.providerId && o.upstreamSlug === effective.upstreamSlug)
              ?.traits.map((t) => (
                <span key={t} className="web-trait-pill">
                  {TRAIT_LABEL[t]}
                </span>
              ))
          : null}
      </span>
    </div>
  );
}

export function WebInterfacingSection({ options, search, fetch, onChange }: Props): JSX.Element {
  return (
    <section aria-label="Web interfacing">
      <h3>Web</h3>
      <p className="web-zk-note">
        Search queries and fetched pages leave your device and are sent to the chosen provider via your
        proxy.
      </p>

      <label htmlFor="web-search-backend">Search backend</label>
      <Picker
        id="web-search-backend"
        role="search"
        options={options}
        setting={search}
        onChange={(s) => onChange({ search: s, fetch })}
      />

      <label htmlFor="web-fetch-backend">Fetch backend</label>
      <Picker
        id="web-fetch-backend"
        role="fetch"
        options={options}
        setting={fetch}
        onChange={(s) => onChange({ search, fetch: s })}
      />
    </section>
  );
}
```

- [ ] **Step 3: Update `WebInterfacingSettings`** (`settings.tsx`) — pass the widened setting through (no logic change beyond types):

```typescript
  const wi = settings.data?.webInterfacing ?? { search: null, fetch: null };
  return (
    <WebInterfacingSection
      options={webBackendOptions(usable)}
      search={wi.search}
      fetch={wi.fetch}
      onChange={(next) => update.mutate({ webInterfacing: next })}
    />
  );
```

(The `aggregateServiceKinds(usable).includes('web')` gate stays — the section only mounts once a `web` offering is usable, which itself requires a configured provider; the corsProxy is required for nano-gpt web offerings to be "usable", so the existing usable-providers gate + the per-tool `requiresProxy` gate together enforce the proxy dependency.)

- [ ] **Step 4: Typecheck + build**

Run: `pnpm typecheck` then `pnpm run build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/WebInterfacingSection.tsx apps/user-client/src/routes/app/settings.tsx apps/user-client/src/boot/client-data-db.ts
git commit -m "Settings: web trait badges, Default/Off picker, zero-knowledge note"
```

---

## Phase C — cockpit depth control

### Task 11: web-search-resolver (tier state)

**Files:**
- Create: `apps/user-client/src/lib/web-search-resolver.ts`
- Test: `apps/user-client/src/lib/web-search-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import type { SearchTier } from '@chatsundere/llm-unified';
import { initialTierId, resolveTierId } from './web-search-resolver.js';

const tiers: SearchTier[] = [
  { id: 'quick', label: 'Quick', params: { depth: 'auto' } },
  { id: 'neural', label: 'Neural', params: { depth: 'neural' } },
];

describe('web-search-resolver', () => {
  it('initial tier is the first (default)', () => {
    expect(initialTierId(tiers)).toBe('quick');
    expect(initialTierId([])).toBeNull();
  });
  it('resolves a selected id, falling back to the default when stale', () => {
    expect(resolveTierId('neural', tiers)).toBe('neural');
    expect(resolveTierId('gone', tiers)).toBe('quick');
    expect(resolveTierId(null, tiers)).toBe('quick');
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/web-search-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { SearchTier } from '@chatsundere/llm-unified';

/** The default tier id (first, cheapest) for a tier list, or null when none. */
export function initialTierId(tiers: SearchTier[]): string | null {
  return tiers[0]?.id ?? null;
}

/** Resolve a (possibly stale or null) selected id against the available tiers,
 *  falling back to the default. */
export function resolveTierId(selected: string | null, tiers: SearchTier[]): string | null {
  if (tiers.length === 0) return null;
  const hit = selected ? tiers.find((t) => t.id === selected) : undefined;
  return (hit ?? tiers[0]).id;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/web-search-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/web-search-resolver.ts apps/user-client/src/lib/web-search-resolver.test.ts
git commit -m "Add web-search-resolver (tier default + stale fallback)"
```

---

### Task 12: Cockpit depth section

**Files:**
- Modify: `apps/user-client/src/components/chat/CockpitMenu.tsx`
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx`
- Modify: the Cockpit's parent (`apps/user-client/src/components/chat/chat-page.tsx` or wherever `<Cockpit … />` is rendered)

- [ ] **Step 1: Add a depth section to `CockpitMenu`**

Extend `Props` and render a depth section when ≥2 tiers exist. Add to `Props`:

```typescript
  searchTiers?: import('@chatsundere/llm-unified').SearchTier[];
  searchTierId?: string | null;
  onSearchTierChange?: (id: string) => void;
```

Change the early `if (p.control.mode === 'none') return null;` so the menu still renders when there are depth tiers:

```typescript
  const hasReasoning = p.control.mode !== 'none';
  const hasDepth = (p.searchTiers?.length ?? 0) >= 2;
  if (!hasReasoning && !hasDepth) return null;
```

Render reasoning only when `hasReasoning`, and add a depth section when `hasDepth`:

```tsx
      {hasDepth ? (
        <div className="cockpit-menu-section" data-section="web-depth">
          <div className="cockpit-menu-label">Web depth</div>
          <div className="cockpit-menu-chips">
            {p.searchTiers!.map((t) =>
              chip(t.label, (p.searchTierId ?? p.searchTiers![0]!.id) === t.id, {
                onClick: () => p.onSearchTierChange?.(t.id),
                dataAttr: ['data-tier', t.id],
              }),
            )}
          </div>
        </div>
      ) : null}
```

- [ ] **Step 2: Thread tiers through `Cockpit`**

Add to `Cockpit` `Props`:

```typescript
  searchTiers?: SearchTier[];
```

In the component, read the tier state from the store and pass to `CockpitMenu`:

```typescript
  const searchTierId = useCurrentChatStore((s) => s.webSearchTierId);
  const setSearchTierId = useCurrentChatStore((s) => s.setWebSearchTierId);
```

```tsx
            <CockpitMenu
              control={p.offering.profile.reasoning}
              reasoning={reasoning}
              onReasoningChange={onReasoningChange}
              searchTiers={p.searchTiers}
              searchTierId={searchTierId}
              onSearchTierChange={setSearchTierId}
              onClose={() => setMenuOpen(false)}
            />
```

- [ ] **Step 3: Resolve + pass the active search offering's tiers from the parent**

In the Cockpit's parent, resolve the effective search backend and look up its `searchTiers`, passing them to `<Cockpit searchTiers={…} />`:

```typescript
import { getOffering } from '@chatsundere/llm-unified';
import { resolveWebBackend } from '../../lib/web-backends.js';
import { webBackendOptions } from '../../lib/web-backend-options.js';
...
  const webOptions = webBackendOptions(usableTemplateIds);
  const effectiveSearch = resolveWebBackend(settings?.webInterfacing?.search ?? null, webOptions, 'search');
  const searchTiers =
    effectiveSearch
      ? getOffering(effectiveSearch.providerId, effectiveSearch.upstreamSlug)?.web?.searchTiers
      : undefined;
```

> Use the same `usableTemplateIds` source the rest of the screen uses. If the parent has no settings handle, lift this resolution to where settings are already read.

- [ ] **Step 4: Update the CockpitMenu test (if present) + typecheck + build**

Run: `pnpm typecheck` then `pnpm run build`
Expected: green. Add/adjust a `CockpitMenu` test asserting the depth chips render for a 2-tier list and call `onSearchTierChange`.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat
git commit -m "Cockpit: web search depth control (per-offering tiers)"
```

---

## Phase D — security, verification, status

### Task 13: Live web-suite (empirical validation, never CI)

**Files:**
- Create: `packages/llm-unified/src/curation/run-web-suite.ts` (follow the existing `run-*-suite.ts` shape)

- [ ] **Step 1: Write a Bun script** that, given `NANOGPT_API_KEY`, hits `/api/web` for linkup/exa/brave and `/scrape-urls`, asserting `data`/`results` shape + non-empty for a known query, printing measured cost. Direct routing (no proxy needed in Bun — CORS is browser-only). Reuse the adapters from Task 2 with a real `fetch`.

- [ ] **Step 2: Run it once locally** (manual, keys never in CI)

Run: `NANOGPT_API_KEY=$(cat keys/.nano-test-key) pnpm --filter @chatsundere/llm-unified exec bun src/curation/run-web-suite.ts`
Expected: linkup/exa/brave each return ≥1 hit; scrape returns markdown; costs printed. On green, the offerings stay `confidence: 'verified'`.

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/src/curation/run-web-suite.ts
git commit -m "Add live web-suite for nano-gpt search/scrape validation"
```

---

### Task 14: Security journal + final verification

**Files:**
- Modify: `obsidian/insights/security-deferrals.md`

- [ ] **Step 1: Append the realised outbound-surface note** — the web adapter sends conversation-derived queries/URLs + the user's nano-gpt key (MK-gated, call-time only, never persisted/logged) through the user's CORS proxy to nano-gpt; the ZK info line discloses it; Phase-2 follow-up: route via `proxy-service` to remove the proxy's plaintext-key sight. (Text-only → `[skip ci]` if committed alone.)

- [ ] **Step 2: Full verification suite**

Run, in order:
- `pnpm typecheck` → expect 13/13
- `pnpm --filter @chatsundere/llm-unified exec bun test` → expect green (note the known canonical-registry flake; verify identical on master if it appears)
- `pnpm --filter @chatsundere/user-client exec vitest run` → expect the pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline (8 fails) unchanged; **every new/modified test passes**. Verify the baseline is identical on master.
- `pnpm run build` → expect 9/9

- [ ] **Step 3: Commit**

```bash
git add obsidian/insights/security-deferrals.md
git commit -m "Log web-interfacing outbound surface in security deferrals [skip ci]"
```

---

## Post-implementation (Liz, not a subagent)

- Squash the feature commits into one unit ("Wire web interfacing live via nano-gpt"), keep the spec/plan as their own `[skip ci]` doc commits.
- Run the manual verification (spec §9) once Chris's VPS proxy is live — this is the go-live gate.
- Update `obsidian/STATUS-CLIENT-ONLY.md` (Done/Next), refresh `Last updated:`.

---

## Self-review notes

- **Spec coverage:** §5.1 proxy primitive → Tasks 2, 7 (reuse `buildRequest`, no `RouteTarget` extraction needed — `ProviderConfig` already is `{baseUrl, routing}`). §5.2 adapters → 2, 3. §5.3 context threading → 7, 8, 9. §5.4 offerings/tiers → 4, 11, 12. §5.5 traits → 1, 4, 5, 10. §5.6 auto-default/off → 6, 9, 10. §5.7 tool copy → 7. §6 data model → 1, 7, 10 (no migration; non-indexed). §7 security/ZK line → 10, 14. §8 tests → every task + 13. §9 manual verification → post-implementation.
- **Type consistency:** `WebBackendSetting` (Task 6) is used in 9, 10; `WebSearchOpts`/`SearchTier`/`WebTrait` (Task 1) flow through 4, 5, 7, 10, 11, 12; `IntegrationRoute` (Task 7) consumed in 8.
- **Deviation from spec, intentional:** no `RouteTarget` type and no Dexie migration — both simplifications justified above; recorded here so the spec reader is not surprised.
