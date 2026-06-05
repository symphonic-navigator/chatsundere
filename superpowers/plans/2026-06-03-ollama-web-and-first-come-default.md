# Ollama-Cloud Web Interfacing + First-Come Default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ollama Cloud as a web search + fetch backend and make the web-backend
default "first-come, first-serve" with graceful fallback when the active backend's
key is removed.

**Architecture:** Part A ports chatsune's Ollama web endpoints into a new
`ollama-web` adapter (mirroring `nano-gpt-web.ts`), exposed as two catalogue web
offerings on the existing `ollama-cloud` provider, routed through the CORS proxy.
Part B sorts usable providers by `createdAt` and adds a ref-fallback to
`resolveWebBackend` — both small, library-local changes. Spec:
`superpowers/specs/2026-06-03-ollama-web-and-first-come-default-design.md`.

**Tech Stack:** TypeScript (strict), Bun test (`packages/llm-unified`), Vitest
(`apps/user-client`), `buildRequest` transport, the web-interfacing spine.

**Conventions:** British English everywhere. No Larissa gate (no auth-/sync-/proxy-
service, no crypto). Subagents never merge/push/switch branches. Run
`pnpm typecheck` after type/schema changes (the CI gate). Verify with the full
suite, not just the touched dir.

---

### Task 1: Ollama web adapter (search + fetch)

**Files:**
- Create: `packages/llm-unified/src/web-adapters/ollama-web.ts`
- Test: `packages/llm-unified/src/web-adapters/ollama-web.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/llm-unified/src/web-adapters/ollama-web.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { WebContext } from '../integrations/web-interfacing.js';
import { ollamaWebFetchAdapter, ollamaWebSearchAdapter } from './ollama-web.js';

const directCtx: WebContext = {
  nsfwAllowed: false,
  location: null,
  corsProxyUrl: null,
  corsProxyKey: null,
};

describe('ollamaWebSearchAdapter', () => {
  it('maps results[] to hits and sends {query, max_results} with Bearer auth (direct)', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(
        JSON.stringify({
          results: [
            { title: 'Ollama', url: 'https://ollama.com', content: 'local models' },
            { title: 'Docs', url: 'https://docs.ollama.com', snippet: 'guide' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    const result = await adapter.search?.('ollama web', directCtx, 'KEY', { numResults: 5 });

    expect(result?.query).toBe('ollama web');
    expect(result?.hits).toHaveLength(2);
    expect(result?.hits[0]).toEqual({
      title: 'Ollama',
      url: 'https://ollama.com',
      snippet: 'local models',
    });
    expect(result?.hits[1]?.snippet).toBe('guide'); // falls back to `snippet`

    const req = captured as unknown as Request;
    expect(req.url).toBe('https://ollama.com/api/web_search');
    expect(req.headers.get('authorization')).toBe('Bearer KEY');
    expect(JSON.parse(await req.text())).toEqual({ query: 'ollama web', max_results: 5 });
  });

  it('clamps max_results into 1..10 and defaults to 5', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fakeFetch = async (req: Request): Promise<Response> => {
      bodies.push(JSON.parse(await req.text()));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    };
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    await adapter.search?.('q', directCtx, 'K', { numResults: 99 });
    await adapter.search?.('q', directCtx, 'K', { numResults: 0 });
    await adapter.search?.('q', directCtx, 'K', {});
    expect(bodies.map((b) => b.max_results)).toEqual([10, 1, 5]);
  });

  it('routes through the cors-proxy when configured', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    };
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    await adapter.search?.(
      'q',
      { ...directCtx, corsProxyUrl: 'https://proxy.example', corsProxyKey: 'P' },
      'KEY',
      {},
    );
    const req = captured as unknown as Request;
    expect(req.url).toBe('https://proxy.example/web_search');
    expect(req.headers.get('x-cors-proxy-api-key')).toBe('P');
    expect(req.headers.get('x-cors-proxy-target')).toBe('https://ollama.com/api');
  });

  it('caps each snippet to bound tool output', async () => {
    const long = 'x'.repeat(2000);
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ results: [{ title: 't', url: 'u', content: long }] }), {
        status: 200,
      });
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    const r = await adapter.search?.('q', directCtx, 'K', {});
    expect((r?.hits[0]?.snippet ?? '').length).toBeLessThanOrEqual(600);
  });

  it('throws on a non-2xx response', async () => {
    const fakeFetch = async (): Promise<Response> => new Response('nope', { status: 500 });
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    await expect(adapter.search?.('q', directCtx, 'K', {})).rejects.toThrow(/HTTP 500/);
  });
});

describe('ollamaWebFetchAdapter', () => {
  it('posts {url} to /web_fetch and returns content', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(JSON.stringify({ content: '# page', title: 'Page' }), { status: 200 });
    };
    const adapter = ollamaWebFetchAdapter(fakeFetch as typeof fetch);
    const r = await adapter.fetch?.('https://x', directCtx, 'K');
    expect(r).toEqual({ url: 'https://x', content: '# page' });

    const req = captured as unknown as Request;
    expect(req.url).toBe('https://ollama.com/api/web_fetch');
    expect(JSON.parse(await req.text())).toEqual({ url: 'https://x' });
  });

  it('throws a constructive error when content is empty', async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ content: '' }), { status: 200 });
    const adapter = ollamaWebFetchAdapter(fakeFetch as typeof fetch);
    await expect(adapter.fetch?.('https://x', directCtx, 'K')).rejects.toThrow(/Could not fetch/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/llm-unified && bun test src/web-adapters/ollama-web.test.ts`
Expected: FAIL — `Cannot find module './ollama-web.js'`.

- [ ] **Step 3: Implement the adapter**

Create `packages/llm-unified/src/web-adapters/ollama-web.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type {
  WebContext,
  WebFetchResult,
  WebInterfacingProvider,
  WebSearchOpts,
  WebSearchResult,
} from '../integrations/web-interfacing.js';
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';

/** Ollama Cloud web endpoints share the `/api` host with `/api/chat`. */
const WEB_BASE_URL = 'https://ollama.com/api';
const SNIPPET_CAP = 600;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** cors-proxy in the browser (ollama.com sends no CORS headers); direct in the
 *  Bun live-suite, where CORS does not apply. */
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
    throw new Error(`ollama web ${path} failed: HTTP ${res.status}`);
  }
  return res.json();
}

interface OllamaSearchPayload {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    snippet?: string;
    description?: string;
  }>;
}

/** Search adapter for Ollama Cloud `/api/web_search`. `fetchImpl` is injectable
 *  for tests. The tier param `numResults` is translated to Ollama's `max_results`
 *  (1–10). */
export function ollamaWebSearchAdapter(fetchImpl: typeof fetch = fetch): WebInterfacingProvider {
  return {
    async search(
      query: string,
      ctx: WebContext,
      key: string,
      opts: WebSearchOpts,
      signal?: AbortSignal,
    ): Promise<WebSearchResult> {
      const max_results = clamp(Math.round(opts.numResults ?? 5), 1, 10);
      const payload = (await postWeb(
        ctx,
        key,
        '/web_search',
        { query, max_results },
        fetchImpl,
        signal,
      )) as OllamaSearchPayload;
      const hits = (payload.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: (r.content ?? r.snippet ?? r.description ?? '').slice(0, SNIPPET_CAP),
      }));
      return { query, hits };
    },
  };
}

interface OllamaFetchPayload {
  content?: string;
  title?: string;
}

/** Fetch adapter for Ollama Cloud `/api/web_fetch`. */
export function ollamaWebFetchAdapter(fetchImpl: typeof fetch = fetch): WebInterfacingProvider {
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
        '/web_fetch',
        { url },
        fetchImpl,
        signal,
      )) as OllamaFetchPayload;
      const content = payload.content ?? '';
      if (!content) {
        throw new Error(`Could not fetch ${url}.`);
      }
      return { url, content };
    },
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/llm-unified && bun test src/web-adapters/ollama-web.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/web-adapters/ollama-web.ts packages/llm-unified/src/web-adapters/ollama-web.test.ts
git commit -m "Add Ollama Cloud web search and fetch adapters"
```

---

### Task 2: Register Ollama web offerings on the catalogue

**Files:**
- Modify: `packages/llm-unified/src/providers/ollama-cloud.ts`
- Modify: `packages/llm-unified/src/providers/builtins.test.ts:123-135` (the ollama-cloud block)

- [ ] **Step 1: Update the failing builtins test first**

In `packages/llm-unified/src/providers/builtins.test.ts`, replace the existing
`ollama-cloud requires proxy and has 2 verified fixed-on offerings` test body
(lines ~123-135) with:

```ts
  it('ollama-cloud has 2 LLM offerings + 2 web offerings (search/fetch)', () => {
    const p = getProvider('ollama-cloud');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('requires-proxy');
      expect(p.offerings).toHaveLength(4);

      const llm = p.offerings.filter((o) => o.serviceKind === 'llm');
      expect(llm.map((o) => o.upstreamSlug).sort()).toEqual(['deepseek-v4-pro', 'glm-5.1']);
      expect(llm.every((o) => o.confidence === 'verified')).toBe(true);
      expect(llm.every((o) => o.adapter.kind === 'catalogue')).toBe(true);
      expect(llm.every((o) => o.profile.reasoning.mode === 'fixed-on')).toBe(true);

      const web = p.offerings.filter((o) => o.serviceKind === 'web');
      expect(web.map((o) => o.upstreamSlug).sort()).toEqual(['web-ollama-fetch', 'web-ollama-search']);
      const search = web.find((o) => o.upstreamSlug === 'web-ollama-search');
      expect(search?.web?.canSearch).toBe(true);
      expect(search?.web?.requiresProxy).toBe(true);
      expect(search?.web?.traits).toEqual(['ai']);
      expect(search?.web?.searchTiers?.[0]?.id).toBe('standard'); // default = 5 results
      expect(search?.web?.searchTiers?.map((t) => t.id)).toEqual(['standard', 'quick', 'deep']);
      const fetch = web.find((o) => o.upstreamSlug === 'web-ollama-fetch');
      expect(fetch?.web?.canFetch).toBe(true);
      expect(fetch?.web?.canSearch).toBe(false);
    }
  });
```

Run: `cd packages/llm-unified && bun test src/providers/builtins.test.ts -t ollama-cloud`
Expected: FAIL (still 2 offerings).

- [ ] **Step 2: Add the web offerings + registration**

In `packages/llm-unified/src/providers/ollama-cloud.ts`:

(a) Extend the imports at the top:

```ts
import { registerAdapter } from '../adapter-registry.js';
import { ollamaNativeAdapter } from '../adapters/ollama-native.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerWebAdapter } from '../integrations/web-adapter-registry.js';
import type { SearchTier, WebOfferingMeta } from '../integrations/web-interfacing.js';
import { ollamaWebFetchAdapter, ollamaWebSearchAdapter } from '../web-adapters/ollama-web.js';
```

(`Offering`/`ReasoningControl` from `../catalogue/types.js`;
`SearchTier`/`WebOfferingMeta` from `../integrations/web-interfacing.js` — exactly
as `nano-gpt.ts` imports them. Keep the existing `registerProvider`,
`ProviderDefinition`, and `apiKeyField` imports; merge the new lines in Biome
import order.)

(b) Add the tiers + web offerings + helper, after the existing `offerings` const:

```ts
// Ollama's /api/web_search takes max_results (1–10). Listed recommended-first so
// tiers[0] (the no-pick default) is the 5-result "standard".
const OLLAMA_TIERS: SearchTier[] = [
  { id: 'standard', label: 'Standard', params: { numResults: 5 } },
  { id: 'quick', label: 'Quick', tooltip: 'fewer results, faster', params: { numResults: 3 } },
  { id: 'deep', label: 'Deep', tooltip: 'more results, slower', params: { numResults: 10 } },
];

function ollamaWebOffering(slug: string, meta: WebOfferingMeta): Offering {
  return {
    canonicalRef: null,
    providerId: 'ollama-cloud',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `ollama-cloud:${slug}` },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: null,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'web',
    web: meta,
  };
}

const webOfferings: Offering[] = [
  ollamaWebOffering('web-ollama-search', {
    canSearch: true,
    canFetch: false,
    requiresProxy: true,
    traits: ['ai'],
    searchTiers: OLLAMA_TIERS,
  }),
  ollamaWebOffering('web-ollama-fetch', {
    canSearch: false,
    canFetch: true,
    requiresProxy: true,
    traits: [],
  }),
];
```

(c) Fold the web offerings into the provider's offering list. Change:

```ts
const offerings: Offering[] = SPECS.map(ollamaOffering);
```

to:

```ts
const offerings: Offering[] = [...SPECS.map(ollamaOffering), ...webOfferings];
```

(d) Register the web adapters inside `registerOllamaCloud()`, after the existing
LLM adapter loop:

```ts
  for (const o of webOfferings) {
    if (o.adapter.kind !== 'catalogue') continue;
    if (o.web?.canFetch) {
      registerWebAdapter(o.adapter.adapterId, () => ollamaWebFetchAdapter());
    } else {
      registerWebAdapter(o.adapter.adapterId, () => ollamaWebSearchAdapter());
    }
  }
```

- [ ] **Step 3: Run the builtins test + the full llm-unified suite**

Run: `cd packages/llm-unified && bun test src/providers/builtins.test.ts -t ollama-cloud && bun test`
Expected: PASS. (If another test asserts a global web-offering count or adapter-
registry size, update it to include the 2 new ollama web offerings.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chatsundere/llm-unified typecheck` (or repo-root `pnpm typecheck`)
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/providers/ollama-cloud.ts packages/llm-unified/src/providers/builtins.test.ts
git commit -m "Curate Ollama Cloud web search and fetch offerings"
```

---

### Task 3: First-come ordering + ref fallback + label fix

**Files:**
- Modify: `apps/user-client/src/lib/usable-providers.ts:14-19`
- Modify: `apps/user-client/src/lib/web-backends.ts:29-32`
- Modify: `apps/user-client/src/lib/web-backend-options.ts:36`
- Create: `apps/user-client/src/lib/web-backends.test.ts`
- Create: `apps/user-client/src/lib/web-backend-options.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/user-client/src/lib/web-backends.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { resolveWebBackend } from './web-backends.js';
import type { WebBackendOption } from './web-backend-options.js';

const opt = (
  providerId: string,
  upstreamSlug: string,
  roles: { canSearch?: boolean; canFetch?: boolean },
): WebBackendOption => ({
  providerId,
  providerName: providerId,
  upstreamSlug,
  label: upstreamSlug,
  canSearch: roles.canSearch ?? false,
  canFetch: roles.canFetch ?? false,
  traits: [],
  requiresProxy: false,
});

const linkup = opt('nano-gpt', 'web-linkup', { canSearch: true });
const ollama = opt('ollama-cloud', 'web-ollama-search', { canSearch: true });

describe('resolveWebBackend', () => {
  it('off returns null', () => {
    expect(resolveWebBackend('off', [linkup], 'search')).toBeNull();
  });

  it('null defaults to the first usable option (first-come order preserved)', () => {
    expect(resolveWebBackend(null, [ollama, linkup], 'search')).toEqual({
      providerId: 'ollama-cloud',
      upstreamSlug: 'web-ollama-search',
    });
  });

  it('null with no usable option returns null', () => {
    expect(resolveWebBackend(null, [opt('x', 'y', { canFetch: true })], 'search')).toBeNull();
  });

  it('an explicit, still-usable ref resolves to itself', () => {
    expect(
      resolveWebBackend({ providerId: 'nano-gpt', upstreamSlug: 'web-linkup' }, [ollama, linkup], 'search'),
    ).toEqual({ providerId: 'nano-gpt', upstreamSlug: 'web-linkup' });
  });

  it('an explicit ref whose backend is gone falls back to the next-best', () => {
    // user had picked nano-gpt/linkup; its key was deleted → only ollama remains
    expect(
      resolveWebBackend({ providerId: 'nano-gpt', upstreamSlug: 'web-linkup' }, [ollama], 'search'),
    ).toEqual({ providerId: 'ollama-cloud', upstreamSlug: 'web-ollama-search' });
  });

  it('an explicit ref with nothing usable returns null', () => {
    expect(
      resolveWebBackend({ providerId: 'nano-gpt', upstreamSlug: 'web-linkup' }, [], 'search'),
    ).toBeNull();
  });
});
```

Create `apps/user-client/src/lib/web-backend-options.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ProviderDefinition } from '@chatsundere/llm-unified';
import { usableTemplateIds } from './usable-providers.js';
import { webBackendOptions } from './web-backend-options.js';
import type { ProviderRow } from '../boot/client-data-db.js';

const row = (templateId: string, createdAt: number): ProviderRow => ({
  id: `id-${templateId}`,
  templateId,
  displayName: templateId,
  baseUrl: '',
  // biome-ignore lint/suspicious/noExplicitAny: test stub for the sealed blob
  apiKey: {} as any,
  routing: { kind: 'direct' },
  enabled: true,
  createdAt,
  updatedAt: createdAt,
});

describe('usableTemplateIds ordering', () => {
  it('orders enabled providers by createdAt (first-configured first)', () => {
    const providers = [row('nano-gpt', 200), row('ollama-cloud', 100)];
    // both are requires-proxy; pass hasProxy=true so neither is dropped
    expect(usableTemplateIds(providers, true)).toEqual(['ollama-cloud', 'nano-gpt']);
  });
});

const webProvider = (id: string, slug: string, canSearch: boolean): ProviderDefinition =>
  ({
    id,
    displayName: id === 'ollama-cloud' ? 'Ollama Cloud' : id,
    offerings: [
      {
        upstreamSlug: slug,
        serviceKind: 'web',
        web: { canSearch, canFetch: !canSearch, traits: [], requiresProxy: false },
      },
    ],
    // biome-ignore lint/suspicious/noExplicitAny: partial stub, only fields read by webBackendOptions
  }) as any;

describe('webBackendOptions labels', () => {
  it('strips web- prefix and -search/-fetch suffix for search labels', () => {
    const lookup = (id: string) => webProvider(id, 'web-ollama-search', true);
    const [o] = webBackendOptions(['ollama-cloud'], false, lookup);
    expect(o?.label).toBe('Ollama');
  });

  it('keeps engine names like Linkup intact', () => {
    const lookup = () => webProvider('nano-gpt', 'web-linkup', true);
    const [o] = webBackendOptions(['nano-gpt'], false, lookup);
    expect(o?.label).toBe('Linkup');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd apps/user-client && pnpm vitest run src/lib/web-backends.test.ts src/lib/web-backend-options.test.ts`
Expected: FAIL — the fallback case returns `null`, the ordering is unsorted, and
the label is `Ollama-search`.

- [ ] **Step 3: Implement the three changes**

(a) `apps/user-client/src/lib/usable-providers.ts` — sort by `createdAt` before mapping:

```ts
export function usableTemplateIds(providers: ProviderRow[], hasProxy: boolean): string[] {
  return providers
    .filter((p) => p.enabled)
    .filter((p) => getProvider(p.templateId)?.corsHint !== 'requires-proxy' || hasProxy)
    .sort((a, b) => a.createdAt - b.createdAt) // first-configured first (first-come default)
    .map((p) => p.templateId);
}
```

(b) `apps/user-client/src/lib/web-backends.ts` — fall back when an explicit ref is
gone (replace the final two lines of `resolveWebBackend`):

```ts
  const match = usable.find(
    (o) => o.providerId === setting.providerId && o.upstreamSlug === setting.upstreamSlug,
  );
  if (match) return refOf(match);
  // The explicit pick is no longer usable (key/provider removed) → next-best,
  // rather than going dark. The stored setting is left untouched so the pick
  // reactivates if its key returns.
  return usable[0] ? refOf(usable[0]) : null;
```

Also update the JSDoc on `resolveWebBackend` to mention the fallback (keep it one
or two lines).

(c) `apps/user-client/src/lib/web-backend-options.ts:36` — strip the role suffix:

```ts
      const bare = o.upstreamSlug.replace(/^web-/, '').replace(/-(search|fetch)$/, '');
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd apps/user-client && pnpm vitest run src/lib/web-backends.test.ts src/lib/web-backend-options.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full frontend suite**

Run: `pnpm typecheck && cd apps/user-client && pnpm vitest run`
Expected: clean typecheck; the full Vitest suite green (verify no other test
depended on the old null-on-missing-ref behaviour or unsorted ordering).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/usable-providers.ts apps/user-client/src/lib/web-backends.ts apps/user-client/src/lib/web-backend-options.ts apps/user-client/src/lib/web-backends.test.ts apps/user-client/src/lib/web-backend-options.test.ts
git commit -m "Default web backend first-come with fallback to next-best"
```

---

### Task 4: Curation record + STATUS (docs)

**Files:**
- Modify: `obsidian/providers/ollama-cloud.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Record the web capability**

Append a short "Web interfacing" section to `obsidian/providers/ollama-cloud.md`:
the two offerings (`web-ollama-search` with tiers 5/3/10, `web-ollama-fetch`),
endpoints `/api/web_search` + `/api/web_fetch`, Bearer auth with the same
`ollama-cloud` key, `requires-proxy`, live-verified date. Note that search and
fetch are separate offerings (mirrors nano-gpt) and the adapter lives at
`web-adapters/ollama-web.ts`.

- [ ] **Step 2: Update STATUS**

Prepend a `Last updated:` entry to `obsidian/STATUS-CLIENT-ONLY.md` describing:
Ollama Cloud now usable for web search + fetch (via CORS proxy); the web-backend
default is now first-come (createdAt order) with fallback to next-best when the
active backend's key is removed. Keep it consistent with the existing entry style.

- [ ] **Step 3: Commit**

```bash
git add obsidian/providers/ollama-cloud.md obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Document Ollama Cloud web interfacing and first-come default [skip ci]"
```

---

## After all tasks (orchestrator only — not a subagent step)

- **Live probe** (local, never CI): with `keys/.ollama-test-key`, run one real
  `web_search` and one real `web_fetch` against `ollama.com`, matching the full
  response serially. Confirm the adapter shapes hold against the live API.
- **Final review** across the whole change.
- **Squash** into two feature units (A: Ollama web adapter + offerings; B:
  first-come default) + the doc commit, then hand to Chris for device verification
  (the §6 manual steps). Do not push until Chris asks.
