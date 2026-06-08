# Subagent Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the artefact author its model's chat-default reasoning, give the expert uplink optional `web_search`/`web_fetch` access (own settings, exa+neural default, visible in the pill), and unify the two subagents' shared base type + web-tool builders.

**Architecture:** Three threads in one feature unit. (a) thread the author offering's default reasoning into `authorArtefact` with a conditional output budget. (b) extract a shared `buildWebTools`, add an independent `expertWeb` setting (Dexie v17) resolved on the send path into the expert's own bounded tool loop, surfaced as new ExpertPill phases. (c) merge `AuthorBase`/`ExpertBase` into `SubagentBase`; deliberately keep the two subagents' execution shapes separate (no shared loop engine).

**Tech Stack:** TypeScript (strict), Bun test (`packages/llm-unified`), Vitest (`apps/user-client`), Dexie, Zustand, React 18, `@chatsundere/llm-unified` streaming primitives.

**Reference spec:** `superpowers/specs/2026-06-08-subagent-improvements-design.md`

---

## File Structure

**Create:**
- `apps/user-client/src/lib/subagent-base.ts` — the shared `SubagentBase` descriptor type (merges `AuthorBase` ≡ `ExpertBase`).
- `apps/user-client/src/integrations/web/build-web-tools.ts` — pure `buildWebTools(input): Tool[]`, the extracted `web_search`/`web_fetch` builders.
- `apps/user-client/src/components/ExpertWebSection.tsx` — settings UI: search/fetch backend pickers + a depth picker.
- `apps/user-client/src/lib/resolve-expert-web.ts` — `resolveExpertWeb(...)`, send-path resolution of the expert's web backends.
- `apps/user-client/tests/unit/build-web-tools.test.ts`, `tests/unit/resolve-expert-web.test.ts`, `tests/unit/expert-web-loop.test.ts`.

**Modify:**
- `apps/user-client/src/lib/artefact-author.ts` — `reasoning` arg + conditional `max_tokens`.
- `apps/user-client/src/integrations/artefact/artefact-integration.ts` — derive + pass author default reasoning.
- `apps/user-client/src/integrations/web/web-integration.ts` — delegate to `buildWebTools`.
- `apps/user-client/src/tools/types.ts` — extend `ToolProgress.phase` + add `detail`.
- `apps/user-client/src/tools/ask-expert.ts` — `expertWeb` param + bounded tool loop; import `SubagentBase`.
- `apps/user-client/src/tools/registry.ts` — `ExpertToolContext.expertWeb`, thread into `createAskExpertTool`.
- `apps/user-client/src/boot/client-data-db.ts` — `SettingsRow.expertWeb`, Dexie v17 migration, seed.
- `apps/user-client/src/data/send-message.ts` — call `resolveExpertWeb`, thread `expertWeb` through `StartArgs`.
- `apps/user-client/src/state/stream-manager.store.ts` — `StartArgs.expertWeb`, pass to `resolveActiveTools`.
- `apps/user-client/src/components/chat/ExpertPill.tsx` — render the new phases + web-step list.
- `apps/user-client/src/routes/app/settings.tsx` — mount `ExpertWebSection`.
- `apps/user-client/tests/components/chat/ExpertPill.test.tsx`, `tests/unit/ask-expert.test.ts` — pill phases + reformulated isolation invariant.

**Lefthook note:** the pre-commit hook runs Biome. Use `git commit` normally; if Biome reports formatting, run `pnpm biome check --write <files>` and re-stage.

---

## Task 1: Shared `SubagentBase` type (c)

**Files:**
- Create: `apps/user-client/src/lib/subagent-base.ts`
- Modify: `apps/user-client/src/lib/artefact-author.ts:28-35`, `apps/user-client/src/tools/ask-expert.ts:13-22`
- Test: none (pure type alias; the compiler is the test — covered by `pnpm typecheck`).

- [ ] **Step 1: Create the shared type**

```ts
// apps/user-client/src/lib/subagent-base.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type {
  CompletionTarget,
  ProviderConfig,
  ProviderDefinition,
} from '@chatsundere/llm-unified';

/** The resolved subset of streaming args a short-lived, structurally-isolated
 *  subagent call needs (the author and the expert). Resolved on the send path,
 *  which holds the MasterKey. Shared so the two subagents cannot drift. */
export interface SubagentBase {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  target: CompletionTarget;
}
```

- [ ] **Step 2: Point `artefact-author.ts` at it**

In `apps/user-client/src/lib/artefact-author.ts`, delete the local `AuthorBase` interface (lines 28-35) and replace with a re-export alias so existing imports keep working:

```ts
import type { SubagentBase } from './subagent-base.js';
// ... (keep the other imports)

/** @deprecated alias — use SubagentBase. Kept so existing imports resolve. */
export type AuthorBase = SubagentBase;
```

Update `AuthorArtefactArgs.base` to `SubagentBase` (or leave as `AuthorBase` alias — both compile).

- [ ] **Step 3: Point `ask-expert.ts` at it**

In `apps/user-client/src/tools/ask-expert.ts`, delete the local `ExpertBase` interface (lines 13-22) and replace:

```ts
import type { SubagentBase } from '../lib/subagent-base.js';

/** @deprecated alias — use SubagentBase. Kept so existing imports resolve. */
export type ExpertBase = SubagentBase;
```

(Imports in `registry.ts`, `stream-manager.store.ts`, `send-message.ts` reference `ExpertBase` — the alias keeps them green; no churn this task.)

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (14/14 projects).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/subagent-base.ts apps/user-client/src/lib/artefact-author.ts apps/user-client/src/tools/ask-expert.ts
git commit -m "Unify subagent base descriptor into SubagentBase"
```

---

## Task 2: Author default reasoning (a)

**Files:**
- Modify: `apps/user-client/src/lib/artefact-author.ts:37-78`
- Modify: `apps/user-client/src/integrations/artefact/artefact-integration.ts:1-44, 69-92`
- Test: `apps/user-client/tests/components/artefact-sheet.test.tsx` is unrelated; add a focused unit test file `apps/user-client/tests/unit/artefact-author-reasoning.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/unit/artefact-author-reasoning.test.ts
import { describe, expect, it } from 'vitest';
import type { StreamChunk } from '@chatsundere/llm-unified';
import { authorArtefact } from '../../src/lib/artefact-author.js';
import type { SubagentBase } from '../../src/lib/subagent-base.js';

const base = {} as SubagentBase;

async function* emit(text: string): AsyncIterable<StreamChunk> {
  yield { type: 'token', text } as StreamChunk;
}

describe('authorArtefact reasoning + budget', () => {
  it('passes the given reasoning intent and bumps max_tokens when enabled', async () => {
    let captured: Record<string, unknown> | undefined;
    const streamFn = ((args: { bodyExtras?: Record<string, unknown> }) => {
      captured = args.bodyExtras;
      return emit('<html></html>');
    }) as unknown as typeof import('@chatsundere/llm-unified').streamCompletion;

    await authorArtefact({
      base,
      brief: 'b',
      reasoning: { enabled: true, effort: 'medium' },
      streamFn,
    });
    expect(captured?.reasoning).toEqual({ enabled: true, effort: 'medium' });
    expect(captured?.max_tokens).toBe(16384);
  });

  it('keeps the 8192 budget when reasoning is disabled', async () => {
    let captured: Record<string, unknown> | undefined;
    const streamFn = ((args: { bodyExtras?: Record<string, unknown> }) => {
      captured = args.bodyExtras;
      return emit('<html></html>');
    }) as unknown as typeof import('@chatsundere/llm-unified').streamCompletion;

    await authorArtefact({ base, brief: 'b', reasoning: { enabled: false }, streamFn });
    expect(captured?.reasoning).toEqual({ enabled: false });
    expect(captured?.max_tokens).toBe(8192);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test artefact-author-reasoning`
Expected: FAIL — `authorArtefact` has no `reasoning` arg; `bodyExtras` still hard-codes `reasoning: { enabled: false }` and `max_tokens: 8192`.

- [ ] **Step 3: Add the `reasoning` arg + conditional budget**

In `apps/user-client/src/lib/artefact-author.ts`, add `reasoning` to `AuthorArtefactArgs` and use it:

```ts
import type { ReasoningIntent, StreamChunk, WireMessage } from '@chatsundere/llm-unified';
// ... existing imports + SubagentBase from Task 1

export interface AuthorArtefactArgs {
  base: SubagentBase;
  brief: string;
  /** The author model's reasoning intent (its chat-default, resolved by the caller). */
  reasoning: ReasoningIntent;
  signal?: AbortSignal;
  onProgress?: (charCount: number) => void;
  streamFn?: typeof streamCompletion;
}
```

In `authorArtefact`, replace the `bodyExtras` line:

```ts
const reasoningEnabled = args.reasoning.enabled === true;
// ...
    bodyExtras: {
      temperature: 0.4,
      max_tokens: reasoningEnabled ? 16384 : 8192,
      reasoning: args.reasoning,
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test artefact-author-reasoning`
Expected: PASS (2/2).

- [ ] **Step 5: Derive + pass the default reasoning from the integration**

In `apps/user-client/src/integrations/artefact/artefact-integration.ts`:

Add imports:

```ts
import {
  initialReasoningState,
  resolveReasoningBodyExtras,
} from '../../lib/reasoning-resolver.js';
import type { ReasoningIntent } from '@chatsundere/llm-unified';
```

In `defaultResolveBase`, after resolving `offering`, the function currently returns the base. Add a sibling resolver that the tool will call for reasoning. Change `defaultResolveBase` to also expose the offering's default reasoning. Simplest: compute it in `execute` where the offering is available. Modify `defaultResolveBase` to return `{ base, reasoning }`:

```ts
function defaultResolveBase(ctx: IntegrationContext): { base: SubagentBase; reasoning: ReasoningIntent } {
  const providerDef = getProvider(ctx.personaOffering.providerId);
  const offering = getOffering(ctx.personaOffering.providerId, ctx.personaOffering.upstreamSlug);
  if (!providerDef || !offering) throw new Error('Artefact author: persona model not resolvable');
  const control = offering.profile.reasoning;
  const reasoning =
    (resolveReasoningBodyExtras(control, initialReasoningState(control)).reasoning as
      | ReasoningIntent
      | undefined) ?? { enabled: false };
  return {
    base: {
      provider: providerDef,
      providerConfig: {
        baseUrl: providerDef.baseUrl,
        routing:
          providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
      },
      apiKey: '',
      corsProxyUrl: ctx.corsProxyUrl,
      corsProxyKey: ctx.corsProxyKey,
      target: offeringToTarget(offering),
    },
    reasoning,
  };
}
```

Update `ArtefactToolDeps.resolveBase` signature to `(ctx) => { base: SubagentBase; reasoning: ReasoningIntent }` and the import (`AuthorBase` → `SubagentBase`). In `execute`, change the resolution + author call:

```ts
const resolved = resolveBase(ctx);
const base = { ...resolved.base, apiKey: key };
const content = await author({
  base,
  brief,
  reasoning: resolved.reasoning,
  signal,
  onProgress: (n) => onProgress?.({ charCount: n }),
});
```

- [ ] **Step 6: Run the full user-client suite for the touched area**

Run: `pnpm --filter @chatsundere/user-client test artefact`
Expected: PASS — existing artefact tests green (the `resolveBase` deps shape changed; if any test injects `resolveBase`, it must now return `{ base, reasoning }` — update those stubs to `{ base: <oldBase>, reasoning: { enabled: false } }`).

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/lib/artefact-author.ts apps/user-client/src/integrations/artefact/artefact-integration.ts apps/user-client/tests/unit/artefact-author-reasoning.test.ts
git commit -m "Run artefact author at the model's chat-default reasoning"
```

---

## Task 3: Extract `buildWebTools` (b/c foundation)

**Files:**
- Create: `apps/user-client/src/integrations/web/build-web-tools.ts`
- Modify: `apps/user-client/src/integrations/web/web-integration.ts:35-139`
- Test: `apps/user-client/tests/unit/build-web-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/unit/build-web-tools.test.ts
import { describe, expect, it } from 'vitest';
import type {
  WebContext,
  WebFetchResult,
  WebInterfacingProvider,
  WebSearchResult,
} from '@chatsundere/llm-unified';
import { buildWebTools } from '../../src/integrations/web/build-web-tools.js';

const ctx: WebContext = { nsfwAllowed: true, location: null, corsProxyUrl: 'p', corsProxyKey: null };

const searchProvider: WebInterfacingProvider = {
  async search(query): Promise<WebSearchResult> {
    return { query, hits: [{ title: 'T', url: 'https://x', snippet: 'S' }] };
  },
};
const fetchProvider: WebInterfacingProvider = {
  async fetch(url): Promise<WebFetchResult> {
    return { url, content: 'BODY' };
  },
};

describe('buildWebTools', () => {
  it('builds a web_search tool that runs the provider and formats hits', async () => {
    const tools = buildWebTools({
      search: { provider: searchProvider, providerId: 'nano-gpt', tierParams: { numResults: 8 } },
      fetch: null,
      ctx,
      getKey: async () => 'k',
    });
    const search = tools.find((t) => t.name === 'web_search');
    expect(search).toBeDefined();
    const r = await search?.execute({ query: 'hi' });
    expect(r?.ok).toBe(true);
    expect(r?.output).toContain('https://x');
  });

  it('builds a web_fetch tool and omits search when no search provider', async () => {
    const tools = buildWebTools({
      search: null,
      fetch: { provider: fetchProvider, providerId: 'nano-gpt' },
      ctx,
      getKey: async () => 'k',
    });
    expect(tools.find((t) => t.name === 'web_search')).toBeUndefined();
    const fetchTool = tools.find((t) => t.name === 'web_fetch');
    const r = await fetchTool?.execute({ url: 'https://x' });
    expect(r?.output).toContain('BODY');
  });

  it('returns an error result when the key is missing', async () => {
    const tools = buildWebTools({
      search: { provider: searchProvider, providerId: 'nano-gpt', tierParams: {} },
      fetch: null,
      ctx,
      getKey: async () => null,
    });
    const r = await tools[0]?.execute({ query: 'x' });
    expect(r?.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test build-web-tools`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `build-web-tools.ts`**

```ts
// apps/user-client/src/integrations/web/build-web-tools.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type {
  WebContext,
  WebFetchResult,
  WebInterfacingProvider,
  WebSearchOpts,
  WebSearchResult,
} from '@chatsundere/llm-unified';
import type { Tool, ToolResult } from '../../tools/types.js';

/** A resolved search backend: the adapter, the provider id (for key lookup), and
 *  the chosen depth tier's params (merged into the request body). */
export interface ResolvedSearch {
  provider: WebInterfacingProvider;
  providerId: string;
  tierParams: WebSearchOpts;
}
/** A resolved fetch backend: the adapter and the provider id. */
export interface ResolvedFetch {
  provider: WebInterfacingProvider;
  providerId: string;
}

export interface BuildWebToolsInput {
  search: ResolvedSearch | null;
  fetch: ResolvedFetch | null;
  ctx: WebContext;
  getKey: (providerId: string) => Promise<string | null>;
}

function formatSearch(result: WebSearchResult): string {
  if (result.hits.length === 0) return `No results for "${result.query}".`;
  return result.hits
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
    .join('\n\n');
}
function formatFetch(result: WebFetchResult): string {
  return `Source: ${result.url}\n\n${result.content}`;
}

/** Build the web_search / web_fetch tools over already-resolved backends. Pure:
 *  no catalogue/registry access — the caller (chat integration or expert) does
 *  the resolution and passes the providers in. Each tool reports a progress
 *  phase ('searching'/'fetching') with the query/host as `detail`. */
export function buildWebTools(input: BuildWebToolsInput): Tool[] {
  const tools: Tool[] = [];

  if (input.search && input.search.provider.search) {
    const { provider, providerId, tierParams } = input.search;
    tools.push({
      name: 'web_search',
      description:
        'Search the web for current, up-to-date information. Lean towards using it when the user explicitly asks you to look something up, rather than searching on your own initiative. Two or three searches are plenty: once you have relevant results, answer the user directly instead of searching again.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query.' } },
        required: ['query'],
      },
      systemPromptInstruction:
        'Use web_search when the user asks for current or external information — prefer searching on request rather than proactively. Keep it to a focused search or two and answer once you have results rather than searching repeatedly.',
      async execute(args, signal, onProgress): Promise<ToolResult> {
        try {
          const key = await input.getKey(providerId);
          if (!key) return { ok: false, output: '', error: 'No API key for the web search backend.' };
          const query = typeof args.query === 'string' ? args.query : '';
          onProgress?.({ charCount: query.length, phase: 'searching', detail: query });
          // biome-ignore lint/style/noNonNullAssertion: gated above
          const result = await provider.search!(query, input.ctx, key, tierParams, signal);
          return { ok: true, output: formatSearch(result), error: null };
        } catch (e) {
          return { ok: false, output: '', error: e instanceof Error ? e.message : 'Web search failed.' };
        }
      },
    });
  }

  if (input.fetch && input.fetch.provider.fetch) {
    const { provider, providerId } = input.fetch;
    tools.push({
      name: 'web_fetch',
      description:
        'Fetch and read the contents of a specific web page by its URL — use it when the user refers to a page, link, or article you should read.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The absolute URL to fetch.' } },
        required: ['url'],
      },
      systemPromptInstruction:
        'You can read a specific page with web_fetch when you have a URL to inspect.',
      async execute(args, signal, onProgress): Promise<ToolResult> {
        try {
          const key = await input.getKey(providerId);
          if (!key) return { ok: false, output: '', error: 'No API key for the web fetch backend.' };
          const url = typeof args.url === 'string' ? args.url : '';
          let host = url;
          try {
            host = new URL(url).host;
          } catch {
            /* keep raw */
          }
          onProgress?.({ charCount: url.length, phase: 'fetching', detail: host });
          // biome-ignore lint/style/noNonNullAssertion: gated above
          const result = await provider.fetch!(url, input.ctx, key, signal);
          return { ok: true, output: formatFetch(result), error: null };
        } catch (e) {
          return { ok: false, output: '', error: e instanceof Error ? e.message : 'Web fetch failed.' };
        }
      },
    });
  }

  return tools;
}
```

NOTE: this references `ToolProgress.phase: 'searching' | 'fetching'` and `detail` — added in Task 5. To keep this task green standalone, do Task 5 (the tiny `types.ts` change) first if the compiler complains; they are listed in dependency order below, so apply Task 5's type change before Step 4 here. (Re-ordered: see Task 5.)

- [ ] **Step 4: Refactor `web-integration.ts` to delegate**

Replace the inlined tool construction in `contributesTools` (lines 62-137) with resolution + `buildWebTools`:

```ts
import { buildWebTools } from './build-web-tools.js';
// ...
    contributesTools(ctx: IntegrationContext): Tool[] {
      const searchR = resolve(ctx.webSearch, ctx);
      const fetchR = resolve(ctx.webFetch, ctx);

      const search =
        searchR?.offering.web?.canSearch && searchR.provider.search
          ? (() => {
              const tiers = searchR.offering.web?.searchTiers ?? [];
              const tier = tiers.find((t) => t.id === ctx.webSearchTierId) ?? tiers[0];
              return {
                provider: searchR.provider,
                providerId: searchR.offering.providerId,
                tierParams: tier?.params ?? {},
              };
            })()
          : null;
      const fetch =
        fetchR?.offering.web?.canFetch && fetchR.provider.fetch
          ? { provider: fetchR.provider, providerId: fetchR.offering.providerId }
          : null;

      return buildWebTools({ search, fetch, ctx: toWebContext(ctx), getKey: ctx.getKey });
    },
```

Delete the now-unused `formatSearch`/`formatFetch` from `web-integration.ts` (they moved into `build-web-tools.ts`).

- [ ] **Step 5: Run both web suites**

Run: `pnpm --filter @chatsundere/user-client test build-web-tools web`
Expected: PASS — `build-web-tools` (3/3) and the existing `web-integration` tests green (behaviour preserved).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/integrations/web/build-web-tools.ts apps/user-client/src/integrations/web/web-integration.ts apps/user-client/tests/unit/build-web-tools.test.ts
git commit -m "Extract shared buildWebTools from the web integration"
```

---

## Task 4: Extend `ToolProgress` phases (b)

> **Do this before Task 3 Step 3 compiles** — `build-web-tools.ts` references the new phases. (Listed here for a clean isolated commit; if executing strictly top-to-bottom, fold this into Task 3 Step 3.)

**Files:**
- Modify: `apps/user-client/src/tools/types.ts:4-9`
- Test: none (type-only; `pnpm typecheck`).

- [ ] **Step 1: Extend the phase union + add `detail`**

```ts
export interface ToolProgress {
  charCount: number;
  /** Multi-phase tools report which phase the count belongs to. ask_expert uses
   *  'reasoning'/'answer' and, when the expert has web access, 'searching'/'fetching'. */
  phase?: 'reasoning' | 'answer' | 'searching' | 'fetching';
  /** Optional human-readable detail for the phase (search query, fetched host). */
  detail?: string;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/tools/types.ts
git commit -m "Add web phases + detail to ToolProgress"
```

---

## Task 5: `expertWeb` settings field + Dexie v17 (b)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts:18-30 (SettingsRow), 552-572 (versions), 671-687 (seed)`
- Test: `apps/user-client/tests/unit/expert-web-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

```ts
// apps/user-client/tests/unit/expert-web-migration.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('Dexie v17 expertWeb', () => {
  it('seeds expertWeb on a fresh settings singleton', async () => {
    const db = await openClientDataDb();
    const s = await db.settings.get(1);
    expect(s?.expertWeb).toEqual({ search: null, fetch: null, searchTierId: null });
    expect(db.verno).toBe(17);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test expert-web-migration`
Expected: FAIL — `verno` is 16 and `expertWeb` is undefined.

- [ ] **Step 3: Add the field to `SettingsRow`**

In `apps/user-client/src/boot/client-data-db.ts`, add to the `SettingsRow` interface (near `webInterfacing`, line ~22):

```ts
  webInterfacing: { search: WebBackendSetting; fetch: WebBackendSetting };
  expertWeb: { search: WebBackendSetting; fetch: WebBackendSetting; searchTierId: string | null };
```

- [ ] **Step 4: Add the v17 migration**

After the `this.version(16)...` block (line ~572), add:

```ts
    // Version 17 — expert web access. Settings gain an independent `expertWeb`
    // block selecting the expert uplink's own web search/fetch backends + depth.
    // null backends mean "auto" (resolved to exa+neural when available).
    this.version(17)
      .stores({ settings: 'id' })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.expertWeb === undefined) {
              s.expertWeb = { search: null, fetch: null, searchTierId: null };
            }
          });
      });
```

- [ ] **Step 5: Seed it on fresh install**

In `seedBuiltinsIfNeeded`, in the `db.settings.add({...})` object (line ~671), add after `webInterfacing`:

```ts
        webInterfacing: { search: null, fetch: null },
        expertWeb: { search: null, fetch: null, searchTierId: null },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test expert-web-migration`
Expected: PASS.

- [ ] **Step 7: Fix any fresh-open verno assertions**

Run: `pnpm --filter @chatsundere/user-client test client-data-db`
If a test asserts `verno === 16`, bump it to 17. Re-run to green.

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/unit/expert-web-migration.test.ts apps/user-client/tests/unit/*client-data-db*
git commit -m "Add expertWeb settings field with Dexie v17 migration"
```

---

## Task 6: `resolveExpertWeb` on the send path (b)

**Files:**
- Create: `apps/user-client/src/lib/resolve-expert-web.ts`
- Test: `apps/user-client/tests/unit/resolve-expert-web.test.ts`

This resolves `settings.expertWeb` into a `BuildWebToolsInput`-shaped result (minus `getKey`, which the caller supplies) plus display labels for the pill. It reuses `resolveWebBackend` for the auto/off/first-come rule, then applies the exa+neural preference on an *auto* (null) search setting.

- [ ] **Step 1: Inspect the existing helpers** (read-only, no edit)

Read `apps/user-client/src/lib/web-backends.ts` (the `resolveWebBackend(setting, options, role)` signature + `WebBackendSetting` union) and `apps/user-client/src/lib/web-backend-options.ts` (`WebBackendOption` shape and how options are built from the catalogue). Confirm: `resolveWebBackend(null, options, 'search')` returns the recommended/first-come `OfferingRef | null`.

- [ ] **Step 2: Write the failing test**

```ts
// apps/user-client/tests/unit/resolve-expert-web.test.ts
import { describe, expect, it } from 'vitest';
import { pickExpertSearchRef } from '../../src/lib/resolve-expert-web.js';

// Pure ref-selection unit (the part that doesn't need MK/db). Full resolution is
// device-verified; here we pin the exa+neural preference + off handling.
const options = [
  { providerId: 'nano-gpt', upstreamSlug: 'web-exa', canSearch: true, canFetch: false, traits: ['neural'], providerName: 'nano-gpt', label: 'Exa' },
  { providerId: 'nano-gpt', upstreamSlug: 'web-linkup', canSearch: true, canFetch: false, traits: ['recommended'], providerName: 'nano-gpt', label: 'Linkup' },
] as const;

describe('pickExpertSearchRef', () => {
  it("prefers exa when the search setting is auto (null) and exa resolves", () => {
    const r = pickExpertSearchRef(null, options as never);
    expect(r?.upstreamSlug).toBe('web-exa');
  });
  it("honours an explicit backend pick", () => {
    const r = pickExpertSearchRef({ providerId: 'nano-gpt', upstreamSlug: 'web-linkup' }, options as never);
    expect(r?.upstreamSlug).toBe('web-linkup');
  });
  it("returns null for an explicit 'off'", () => {
    expect(pickExpertSearchRef('off', options as never)).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test resolve-expert-web`
Expected: FAIL — module/`pickExpertSearchRef` missing.

- [ ] **Step 4: Implement `resolve-expert-web.ts`**

```ts
// apps/user-client/src/lib/resolve-expert-web.ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Offering,
  type WebContext,
  type WebInterfacingProvider,
  getOffering,
  resolveWebAdapter,
} from '@chatsundere/llm-unified';
import type { MasterKey } from '@chatsundere/crypto';
import { getClientDataDb } from '../boot/client-data-db.js';
import type { ResolvedFetch, ResolvedSearch } from '../integrations/web/build-web-tools.js';
import type { OfferingRef } from '../integrations/types.js';
import { openSecret } from '../lib/secret-box.js'; // confirm the actual decrypt helper path used by resolveExpert
import type { WebBackendOption } from './web-backend-options.js';
import { type WebBackendSetting, resolveWebBackend } from './web-backends.js';

const EXA_SLUG = 'web-exa';

/** Pure ref selection: honour an explicit pick / 'off'; on auto (null) prefer the
 *  exa backend when present, else fall back to resolveWebBackend's recommendation. */
export function pickExpertSearchRef(
  setting: WebBackendSetting,
  options: WebBackendOption[],
): OfferingRef | null {
  if (setting === 'off') return null;
  if (setting && typeof setting === 'object') return setting;
  // auto (null): prefer exa
  const exa = options.find((o) => o.upstreamSlug === EXA_SLUG && o.canSearch);
  if (exa) return { providerId: exa.providerId, upstreamSlug: exa.upstreamSlug };
  return resolveWebBackend(null, options, 'search');
}

/** Pick the fetch ref: explicit / off / auto via resolveWebBackend. */
export function pickExpertFetchRef(
  setting: WebBackendSetting,
  options: WebBackendOption[],
): OfferingRef | null {
  if (setting === 'off') return null;
  if (setting && typeof setting === 'object') return setting;
  return resolveWebBackend(null, options, 'fetch');
}

export interface ResolvedExpertWeb {
  search: ResolvedSearch | null;
  fetch: ResolvedFetch | null;
  ctx: WebContext;
  /** Provider rows already decrypted? No — key is fetched at call time via getKey
   *  threaded from the integration context. We carry only refs/providers here. */
}

interface ResolveArgs {
  expertWeb: { search: WebBackendSetting; fetch: WebBackendSetting; searchTierId: string | null };
  options: WebBackendOption[];
  nsfwAllowed: boolean;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
}

/** Resolve the expert's web backends into a ResolvedExpertWeb. Returns null when
 *  neither search nor fetch resolves (the expert then has no web tools). The
 *  catalogue + adapter registry are consulted; the API key is NOT fetched here —
 *  the caller supplies a getKey to buildWebTools at call time. */
export function resolveExpertWeb(args: ResolveArgs): ResolvedExpertWeb | null {
  const ctx: WebContext = {
    nsfwAllowed: args.nsfwAllowed,
    location: null,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
  };

  const resolveOne = (
    ref: OfferingRef | null,
    role: 'search' | 'fetch',
  ): { offering: Offering; provider: WebInterfacingProvider } | null => {
    if (!ref) return null;
    const offering = getOffering(ref.providerId, ref.upstreamSlug);
    if (!offering || offering.serviceKind !== 'web' || !offering.web) return null;
    if (offering.web.requiresProxy && !args.corsProxyUrl) return null;
    if (offering.adapter.kind !== 'catalogue') return null;
    const provider = resolveWebAdapter(offering.adapter.adapterId);
    if (!provider) return null;
    if (role === 'search' && (!offering.web.canSearch || !provider.search)) return null;
    if (role === 'fetch' && (!offering.web.canFetch || !provider.fetch)) return null;
    return { offering, provider };
  };

  const searchRef = pickExpertSearchRef(args.expertWeb.search, args.options);
  const fetchRef = pickExpertFetchRef(args.expertWeb.fetch, args.options);
  const searchRes = resolveOne(searchRef, 'search');
  const fetchRes = resolveOne(fetchRef, 'fetch');

  let search: ResolvedSearch | null = null;
  if (searchRes) {
    const tiers = searchRes.offering.web?.searchTiers ?? [];
    // exa default depth = neural; otherwise the chosen tier id, else the first tier.
    const preferNeural = searchRes.offering.upstreamSlug === EXA_SLUG;
    const tier =
      tiers.find((t) => t.id === args.expertWeb.searchTierId) ??
      (preferNeural ? tiers.find((t) => t.id === 'neural') : undefined) ??
      tiers[0];
    search = {
      provider: searchRes.provider,
      providerId: searchRes.offering.providerId,
      tierParams: tier?.params ?? {},
    };
  }
  const fetch: ResolvedFetch | null = fetchRes
    ? { provider: fetchRes.provider, providerId: fetchRes.offering.providerId }
    : null;

  if (!search && !fetch) return null;
  return { search, fetch, ctx };
}
```

> **Implementer note:** confirm the import paths for `MasterKey`/`openSecret`/`WebBackendOption` against `resolveExpert` in `send-message.ts` and `web-backend-options.ts`. The key is NOT decrypted in this module (the integration context's `getKey` handles it at call time). Drop the unused `MasterKey`/`openSecret` imports — they were sketched for symmetry with `resolveExpert` but resolution here needs only catalogue + registry. Keep only what compiles.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test resolve-expert-web`
Expected: PASS (3/3).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/lib/resolve-expert-web.ts apps/user-client/tests/unit/resolve-expert-web.test.ts
git commit -m "Add resolveExpertWeb send-path backend resolution"
```

---

## Task 7: Expert bounded tool loop (b)

**Files:**
- Modify: `apps/user-client/src/tools/ask-expert.ts:50-130`
- Test: `apps/user-client/tests/unit/expert-web-loop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/unit/expert-web-loop.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { StreamChunk } from '@chatsundere/llm-unified';
import { createAskExpertTool } from '../../src/tools/ask-expert.js';
import { buildWebTools } from '../../src/integrations/web/build-web-tools.js';
import type { SubagentBase } from '../../src/lib/subagent-base.js';

const base = {} as SubagentBase;

function streamOf(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

describe('expert tool loop', () => {
  it('dispatches a web_search call then returns the follow-up answer', async () => {
    const webTools = buildWebTools({
      search: {
        provider: { async search(q) { return { query: q, hits: [{ title: 'T', url: 'https://x', snippet: 'S' }] }; } },
        providerId: 'nano-gpt',
        tierParams: {},
      },
      fetch: null,
      ctx: { nsfwAllowed: true, location: null, corsProxyUrl: 'p', corsProxyKey: null },
      getKey: async () => 'k',
    });

    let call = 0;
    const streamFn = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return streamOf([{ type: 'tool-call', toolCallId: 'c1', name: 'web_search', argumentsJson: '{"query":"q"}' }]);
      }
      return streamOf([{ type: 'token', text: 'final answer' }]);
    }) as unknown as typeof import('@chatsundere/llm-unified').streamCompletion;

    const phases: string[] = [];
    const tool = createAskExpertTool(base, 'opus', { enabled: true }, true, streamFn, {
      tools: webTools,
      maxRounds: 8,
    });
    const r = await tool.execute({ question: 'hard?' }, undefined, (p) => p.phase && phases.push(p.phase));
    expect(r.ok).toBe(true);
    expect(r.output).toBe('final answer');
    expect(phases).toContain('searching');
    expect(call).toBe(2);
    const meta = r.meta as { webSteps?: { kind: string; detail: string }[] };
    expect(meta.webSteps?.[0]).toEqual({ kind: 'searching', detail: 'q' });
  });

  it('still works as a single shot when no expertWeb is given', async () => {
    const streamFn = (() => streamOf([{ type: 'token', text: 'plain' }])) as unknown as typeof import('@chatsundere/llm-unified').streamCompletion;
    const tool = createAskExpertTool(base, 'm', { enabled: true }, true, streamFn);
    const r = await tool.execute({ question: 'q' });
    expect(r.output).toBe('plain');
  });

  it('forces an answer after the round cap', async () => {
    const streamFn = (() => streamOf([{ type: 'tool-call', toolCallId: 'c', name: 'web_search', argumentsJson: '{"query":"x"}' }])) as unknown as typeof import('@chatsundere/llm-unified').streamCompletion;
    const webTools = buildWebTools({
      search: { provider: { async search(q) { return { query: q, hits: [] }; } }, providerId: 'p', tierParams: {} },
      fetch: null,
      ctx: { nsfwAllowed: true, location: null, corsProxyUrl: 'p', corsProxyKey: null },
      getKey: async () => 'k',
    });
    const tool = createAskExpertTool(base, 'm', { enabled: true }, true, streamFn, { tools: webTools, maxRounds: 2 });
    const r = await tool.execute({ question: 'q' });
    // No final text ever produced → constructive error after the cap, not a hang.
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test expert-web-loop`
Expected: FAIL — `createAskExpertTool` takes no 6th `expertWeb` arg; no loop.

- [ ] **Step 3: Rewrite `createAskExpertTool` with the loop**

Replace `ask-expert.ts` from the `createAskExpertTool` signature through `execute`. Key changes: add an optional `expertWeb?: { tools: Tool[]; maxRounds: number }` param; build `webToolDefs` from it; run a bounded loop accumulating reasoning chars, the round's answer, and `webSteps`. Add the web nudge to `EXPERT_SYSTEM_PROMPT`.

```ts
import { type ToolDef } from '@chatsundere/llm-unified';
import { dispatch, toolDefs } from './registry.js'; // dispatch + toolDefs already exported
// keep existing imports + SubagentBase alias

export const EXPERT_SYSTEM_PROMPT =
  'You are a subject-matter expert consulted on a single, self-contained technical ' +
  'question — typically mathematics, science, software engineering, or another rigorous ' +
  'domain. Answer it precisely, rigorously, and completely; show the key steps where they ' +
  'aid correctness. You have no access to any prior conversation, so treat the question as ' +
  'wholly standalone and do not ask for clarification — state any assumptions you must make. ' +
  'You may use web_search / web_fetch when current or external facts would improve the answer; ' +
  'keep it to a few focused searches, then answer. ' +
  'Answer the question as asked, without moralising or adding unsolicited caveats.';

export interface ExpertWeb {
  tools: Tool[];
  maxRounds: number;
}

export function createAskExpertTool(
  base: SubagentBase,
  modelLabel: string,
  reasoning: ReasoningIntent,
  runtimeEnabled: boolean,
  streamFn: typeof streamCompletion = streamCompletion,
  expertWeb?: ExpertWeb,
): Tool {
  return {
    name: 'ask_expert',
    description:
      'Forward one self-contained technical question to a more capable expert model and return its answer.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description:
            'A clean, standalone technical question with every fact needed to answer it, and no personal, emotional, or relational context.',
        },
      },
      required: ['question'],
    },
    systemPromptInstruction: INSTRUCTION,

    async execute(args, signal, onProgress): Promise<ToolResult> {
      if (!runtimeEnabled) {
        return {
          ok: false,
          output: '',
          error:
            'The expert is switched off for this chat. Answer the question yourself as best you can; do not call ask_expert again this turn.',
        };
      }
      const question = typeof args.question === 'string' ? args.question : '';
      if (question.trim().length === 0) {
        return { ok: false, output: '', error: 'No question provided.' };
      }

      const webTools = expertWeb?.tools ?? [];
      const webDefs: ToolDef[] = webTools.length > 0 ? toolDefs(webTools) : [];
      const maxRounds = expertWeb?.maxRounds ?? 0;

      // INVARIANT (isolation): the conversation begins with EXACTLY the expert
      // system prompt + the sanitised question. Only the expert's OWN tool calls
      // and their results are appended below — never persona/history/about-me.
      const messages: WireMessage[] = [
        { role: 'system', content: EXPERT_SYSTEM_PROMPT },
        { role: 'user', content: question },
      ];
      let answer = '';
      let reasoningChars = 0;
      const webSteps: { kind: 'searching' | 'fetching'; detail: string }[] = [];

      for (let round = 0; ; round++) {
        const forceAnswer = maxRounds === 0 || round >= maxRounds;
        let roundAnswer = '';
        const roundCalls: { toolCallId: string; name: string; argumentsJson: string }[] = [];
        try {
          for await (const chunk of streamFn({
            provider: base.provider,
            providerConfig: base.providerConfig,
            apiKey: base.apiKey,
            corsProxyUrl: base.corsProxyUrl,
            corsProxyKey: base.corsProxyKey,
            target: base.target,
            messages,
            bodyExtras: { reasoning },
            tools: forceAnswer ? undefined : webDefs.length > 0 ? webDefs : undefined,
            signal,
          } as Parameters<typeof streamCompletion>[0])) {
            const c = chunk as StreamChunk;
            if (c.type === 'reasoning') {
              reasoningChars += c.text.length;
              onProgress?.({ charCount: reasoningChars, phase: 'reasoning' });
            } else if (c.type === 'token') {
              roundAnswer += c.text;
              onProgress?.({ charCount: roundAnswer.length, phase: 'answer' });
            } else if (c.type === 'tool-call') {
              roundCalls.push({ toolCallId: c.toolCallId, name: c.name, argumentsJson: c.argumentsJson });
            } else if (c.type === 'error') {
              throw new Error(c.message);
            }
          }
        } catch (e) {
          return { ok: false, output: '', error: e instanceof Error ? e.message : 'Expert call failed.' };
        }

        if (roundCalls.length === 0 || forceAnswer) {
          answer = roundAnswer;
          break;
        }

        // Dispatch each web tool call; append assistant(tool_calls) + tool results.
        const toolResultMsgs: WireMessage[] = [];
        for (const call of roundCalls) {
          const onWebProgress = (p: import('./types.js').ToolProgress): void => {
            if (p.phase === 'searching' || p.phase === 'fetching') {
              webSteps.push({ kind: p.phase, detail: p.detail ?? '' });
              onProgress?.({ charCount: p.charCount, phase: p.phase, detail: p.detail });
            }
          };
          const parsed = ((): Record<string, unknown> => {
            try {
              const v = JSON.parse(call.argumentsJson);
              return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
            } catch {
              return {};
            }
          })();
          const r = await dispatch(webTools, call.name, parsed, signal, onWebProgress);
          toolResultMsgs.push({
            role: 'tool',
            tool_call_id: call.toolCallId,
            content: r.ok ? r.output : (r.error ?? ''),
          });
        }
        messages.push({
          role: 'assistant',
          content: roundAnswer,
          tool_calls: roundCalls.map((c) => ({
            id: c.toolCallId,
            type: 'function',
            function: { name: c.name, arguments: c.argumentsJson },
          })),
        });
        messages.push(...toolResultMsgs);
      }

      if (answer.trim().length === 0) {
        return { ok: false, output: '', error: 'The expert returned no answer.' };
      }
      return {
        ok: true,
        output: answer,
        error: null,
        meta: { question, model: modelLabel, webSteps },
      };
    },
  };
}
```

> **Note on `dispatch`/`toolDefs` import:** they live in `registry.ts`, which imports `createAskExpertTool` from `ask-expert.ts` — a require cycle. To avoid it, import `toolDefs`/`dispatch` lazily or move both pure helpers into a small `tools/tool-defs.ts` and re-export from `registry.ts`. **Preferred:** create `apps/user-client/src/tools/tool-defs.ts` containing `toolDefs` + `dispatch` (cut from `registry.ts`), have `registry.ts` re-export them, and import from `tool-defs.ts` here. Verify no cycle with `pnpm typecheck`.

- [ ] **Step 4: Resolve the import cycle (if present)**

Create `apps/user-client/src/tools/tool-defs.ts` with the `toolDefs` and `dispatch` functions moved verbatim from `registry.ts:46-72` (and the `ToolResult`/`ToolDef`/`Tool` imports they need). In `registry.ts`, replace the definitions with `export { toolDefs, dispatch } from './tool-defs.js';`. Import them in `ask-expert.ts` from `./tool-defs.js`.

- [ ] **Step 5: Run the loop tests**

Run: `pnpm --filter @chatsundere/user-client test expert-web-loop ask-expert`
Expected: PASS — new loop tests green; existing `ask-expert` tests green except the isolation test, which Task 9 reformulates (if it fails now on "exactly two messages", mark it and fix in Task 9, or run with `-t` to exclude it temporarily).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/tools/ask-expert.ts apps/user-client/src/tools/tool-defs.ts apps/user-client/src/tools/registry.ts apps/user-client/tests/unit/expert-web-loop.test.ts
git commit -m "Give the expert a bounded web tool loop"
```

---

## Task 8: Thread `expertWeb` through the wiring (b)

**Files:**
- Modify: `apps/user-client/src/tools/registry.ts:13-44` (ExpertToolContext + pass-through)
- Modify: `apps/user-client/src/state/stream-manager.store.ts:78-80, 383-391` (StartArgs + expert assembly)
- Modify: `apps/user-client/src/data/send-message.ts:83-86, 131-158` (resolve + thread)
- Test: covered by existing `stream-manager-store` + `current-chat-store` suites; add no new unit test (device-verified end-to-end).

- [ ] **Step 1: Extend `ExpertToolContext` + pass it through**

In `registry.ts`:

```ts
import type { ExpertWeb } from './ask-expert.js';

export interface ExpertToolContext {
  base: ExpertBase;
  modelLabel: string;
  reasoning: ReasoningIntent;
  runtimeEnabled: boolean;
  web?: ExpertWeb;
}
```

In `resolveActiveTools`, pass it:

```ts
    ...(expert
      ? [createAskExpertTool(expert.base, expert.modelLabel, expert.reasoning, expert.runtimeEnabled, undefined, expert.web)]
      : []),
```

- [ ] **Step 2: Build the `ExpertWeb` in the stream-manager**

In `stream-manager.store.ts`, add to `StartArgs` (near `expertBase`, line ~78):

```ts
  expertBase?: ExpertBase;
  expertReasoning?: ReasoningIntent;
  expertModelLabel?: string;
  expertWeb?: import('../lib/resolve-expert-web.js').ResolvedExpertWeb | null;
```

In the expert assembly (line ~383), build the web tools when present, using the integration context's `getKey`:

```ts
import { buildWebTools } from '../integrations/web/build-web-tools.js';
import { EXPERT_MAX_ROUNDS } from '../tools/ask-expert.js'; // export a const = 8 from ask-expert
// ...
  const expert = args.expertBase
    ? {
        base: args.expertBase,
        modelLabel: args.expertModelLabel ?? 'expert',
        reasoning: args.expertReasoning ?? { enabled: true },
        runtimeEnabled: useCurrentChatStore.getState().askExpert,
        web: args.expertWeb
          ? {
              tools: buildWebTools({
                search: args.expertWeb.search,
                fetch: args.expertWeb.fetch,
                ctx: args.expertWeb.ctx,
                getKey: integrationCtx.getKey,
              }),
              maxRounds: EXPERT_MAX_ROUNDS,
            }
          : undefined,
      }
    : null;
```

Add to `ask-expert.ts`: `export const EXPERT_MAX_ROUNDS = 8;` and use it as the default `maxRounds` where the tool is built (or keep the explicit pass here).

- [ ] **Step 3: Resolve `expertWeb` in `send-message.ts`**

In `data/send-message.ts`, where `resolveExpert` is called (line ~138) and the context assembled (lines ~131-158): build the web-backend options and call `resolveExpertWeb`. Reuse however the chat builds `webOptions` (line ~131 already builds `webOptions` for `resolveWebBackend`). Add:

```ts
import { resolveExpertWeb } from '../lib/resolve-expert-web.js';
// ...
  const expertWeb = settings.expertModel
    ? resolveExpertWeb({
        expertWeb: settings.expertWeb ?? { search: null, fetch: null, searchTierId: null },
        options: webOptions, // the same WebBackendOption[] used for chat web resolution
        nsfwAllowed: persona.adultPersona === true,
        corsProxyUrl,
        corsProxyKey,
      })
    : null;
```

> **Implementer note:** confirm `webOptions` at line ~131 is the `WebBackendOption[]` shape `resolveExpertWeb` expects. If `resolveWebBackend` there is fed a different option list, build the options once and reuse for both. Thread `expertWeb` into the `StartArgs` object(s) passed to `start`/`regenerate` (the two call sites at lines ~404 and ~516 that already pass `expertBase`/`expertModelLabel`):

```ts
        expertBase: ctx.expertBase ?? undefined,
        expertModelLabel: ctx.expertModelLabel ?? undefined,
        expertWeb: ctx.expertWeb ?? null,
```

Add `expertWeb: ResolvedExpertWeb | null` to the `ctx`/`SendContext` interface (near `expertBase`, line ~85) and set it where `expert` is unpacked (line ~158).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Run the affected suites**

Run: `pnpm --filter @chatsundere/user-client test stream-manager ask-expert send-message current-chat`
Expected: PASS (the isolation test in `ask-expert` is reformulated in Task 9).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/tools/registry.ts apps/user-client/src/state/stream-manager.store.ts apps/user-client/src/data/send-message.ts apps/user-client/src/tools/ask-expert.ts
git commit -m "Thread expertWeb resolution through the send path"
```

---

## Task 9: Reformulate the isolation invariant test (b)

**Files:**
- Modify: `apps/user-client/tests/unit/ask-expert.test.ts` (the existing isolation test)

- [ ] **Step 1: Find the existing invariant test**

Run: `rg -n "system|user|messages|exactly two|isolation" apps/user-client/tests/unit/ask-expert.test.ts`
Identify the test asserting the expert sees exactly `[system, user]` (the load-bearing isolation test).

- [ ] **Step 2: Rewrite it to the new invariant**

Replace it with a test that captures the messages passed to `streamFn` across a tool round and asserts: (1) `messages[0]` is `{ role: 'system', content: EXPERT_SYSTEM_PROMPT }`; (2) `messages[1]` is `{ role: 'user', content: <question> }`; (3) every later message has role `'assistant'` (with `tool_calls`) or `'tool'` — i.e. only the expert's own tool traffic, never another `system`/`user` message and no chat content.

```ts
import { EXPERT_SYSTEM_PROMPT, createAskExpertTool } from '../../src/tools/ask-expert.js';
// ... build webTools as in expert-web-loop.test.ts, capture each streamFn call's messages

it('keeps the expert isolated: only system+question, then its own tool traffic', async () => {
  const seen: { role: string }[][] = [];
  let call = 0;
  const streamFn = ((a: { messages: { role: string; content: string }[] }) => {
    seen.push(a.messages.map((m) => ({ role: m.role })));
    call += 1;
    if (call === 1)
      return streamOf([{ type: 'tool-call', toolCallId: 'c', name: 'web_search', argumentsJson: '{"query":"q"}' }]);
    return streamOf([{ type: 'token', text: 'done' }]);
  }) as never;
  const tool = createAskExpertTool({} as never, 'm', { enabled: true }, true, streamFn, { tools: webTools, maxRounds: 8 });
  await tool.execute({ question: 'Q' });

  // Second (answering) round carries the full exchange.
  const msgs = seen[1];
  expect(msgs[0].role).toBe('system');
  expect(msgs[1].role).toBe('user');
  for (const m of msgs.slice(2)) expect(['assistant', 'tool']).toContain(m.role);
  // and the first round was exactly system+user
  expect(seen[0].map((m) => m.role)).toEqual(['system', 'user']);
});
```

(Keep the existing assertion that the first message content is `EXPERT_SYSTEM_PROMPT` and the second is the verbatim question.)

- [ ] **Step 3: Run it**

Run: `pnpm --filter @chatsundere/user-client test ask-expert`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/tests/unit/ask-expert.test.ts
git commit -m "Reformulate the expert isolation invariant for the tool loop"
```

---

## Task 10: ExpertPill web phases + step list (b)

**Files:**
- Modify: `apps/user-client/src/components/chat/ExpertPill.tsx:5-13, 35-51, 85-90`
- Test: `apps/user-client/tests/components/chat/ExpertPill.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `ExpertPill.test.tsx`:

```ts
it('shows the searching phase with the query while pending', () => {
  const row = {
    kind: 'tool-call', status: 'pending',
    payload: { model: 'opus', phase: 'searching', detail: 'lie groups', charCount: 9 },
  } as never;
  render(<ExpertPill row={row} />);
  expect(screen.getByText(/sucht im Web/i)).toBeTruthy();
  expect(screen.getByText(/lie groups/i)).toBeTruthy();
});

it('lists web steps in the expanded completed pill', () => {
  const row = {
    kind: 'tool-call', status: 'completed',
    payload: {
      model: 'opus', question: 'Q', result: 'A',
      webSteps: [{ kind: 'searching', detail: 'q1' }, { kind: 'fetching', detail: 'example.com' }],
    },
  } as never;
  render(<ExpertPill row={row} />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText(/q1/)).toBeTruthy();
  expect(screen.getByText(/example\.com/)).toBeTruthy();
});
```

> British-English UI note (CLAUDE.md §3/§7): user-facing copy is British English. The pending label text is German in the *device* per the live-chat-is-German rule? No — UI strings are British English. Use **"searching the web"** / **"reading page"** in the component; the test above matches German placeholders only as illustration — **write the assertions against the British-English strings you ship** ("searching the web", "reading"). Update the test text accordingly before running.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test ExpertPill`
Expected: FAIL.

- [ ] **Step 3: Extend `ExpertPayload` + the pending render**

```ts
interface ExpertPayload {
  model?: string;
  question?: string;
  argumentsJson?: string;
  result?: string;
  error?: string;
  charCount?: number;
  phase?: 'reasoning' | 'answer' | 'searching' | 'fetching';
  detail?: string;
  webSteps?: { kind: 'searching' | 'fetching'; detail: string }[];
}
```

In the pending branch, derive the label from the phase:

```ts
  if (row.status === 'pending') {
    let line: JSX.Element;
    if (p.phase === 'searching') {
      line = <>searching the web · <em>{p.detail}</em></>;
    } else if (p.phase === 'fetching') {
      line = <>reading · <em>{p.detail}</em></>;
    } else {
      const verb = p.phase === 'answer' ? 'answering' : 'thinking';
      line = <>{verb} · {chars} chars</>;
    }
    return (
      <span className="artefact-pill" data-state="building">
        <span className="artefact-pill-ic" aria-hidden>↑</span>
        <span className="artefact-pill-ttl">{model}</span>
        <span className="artefact-pill-sub">{line}</span>
        <span className="artefact-pill-bar"><i /></span>
      </span>
    );
  }
```

- [ ] **Step 4: Add the web-step list to the expanded completed pill**

In the completed branch's expanded block (after the result `<code>`):

```ts
      {expanded ? (
        <span className="pill-detail">
          {question && <code className="pill-detail-code">{question}</code>}
          {p.webSteps && p.webSteps.length > 0 ? (
            <span className="pill-detail-websteps">
              {p.webSteps.map((s, i) => (
                <span key={`${s.kind}-${i}`} className="pill-webstep">
                  {s.kind === 'searching' ? 'searched' : 'read'} · {s.detail}
                </span>
              ))}
            </span>
          ) : null}
          {p.result !== undefined && <code className="pill-detail-result">{p.result}</code>}
        </span>
      ) : null}
```

- [ ] **Step 5: Run the pill tests**

Run: `pnpm --filter @chatsundere/user-client test ExpertPill`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/ExpertPill.tsx apps/user-client/tests/components/chat/ExpertPill.test.tsx
git commit -m "Surface expert web activity in the ExpertPill"
```

---

## Task 11: Settings UI — Expert web access (b)

**Files:**
- Create: `apps/user-client/src/components/ExpertWebSection.tsx`
- Modify: `apps/user-client/src/routes/app/settings.tsx:280-295` (mount it near the chat web section)
- Test: `apps/user-client/tests/routes/persona-editor.mindspace.test.tsx` is unrelated; add `apps/user-client/tests/components/expert-web-section.test.tsx`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/components/expert-web-section.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExpertWebSection } from '../../src/components/ExpertWebSection.js';

const options = [
  { providerId: 'nano-gpt', upstreamSlug: 'web-exa', canSearch: true, canFetch: false, traits: ['neural'], providerName: 'nano-gpt', label: 'Exa', searchTiers: [{ id: 'quick', label: 'Quick', params: {} }, { id: 'neural', label: 'Neural', params: { depth: 'neural' } }] },
] as never;

describe('ExpertWebSection', () => {
  it('renders search/fetch pickers + a depth picker and emits changes', () => {
    const onChange = vi.fn();
    render(
      <ExpertWebSection options={options} value={{ search: null, fetch: null, searchTierId: null }} onChange={onChange} />,
    );
    expect(screen.getByLabelText(/search backend/i)).toBeTruthy();
    expect(screen.getByLabelText(/depth/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/depth/i), { target: { value: 'neural' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ searchTierId: 'neural' }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test expert-web-section`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ExpertWebSection.tsx`**

Model it on `WebInterfacingSection.tsx` (reuse its `Picker` pattern; do not duplicate — import the existing `Picker` if it is exported, otherwise factor the section to render two backend pickers + one depth `<select>`). The depth picker lists the resolved search backend's `searchTiers`; it is disabled when the backend has none.

```tsx
// apps/user-client/src/components/ExpertWebSection.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { WebBackendOption } from '../lib/web-backend-options.js';
import { type WebBackendSetting, resolveWebBackend } from '../lib/web-backends.js';
import { WebInterfacingSection } from './WebInterfacingSection.js';

export interface ExpertWebValue {
  search: WebBackendSetting;
  fetch: WebBackendSetting;
  searchTierId: string | null;
}
interface Props {
  options: WebBackendOption[];
  value: ExpertWebValue;
  onChange: (next: ExpertWebValue) => void;
}

/** Settings for the expert uplink's own web access: the two backend pickers
 *  (reused from WebInterfacingSection) plus a search-depth picker. */
export function ExpertWebSection({ options, value, onChange }: Props): JSX.Element {
  const effectiveSearch = resolveWebBackend(value.search, options, 'search');
  const searchOption = effectiveSearch
    ? options.find(
        (o) => o.providerId === effectiveSearch.providerId && o.upstreamSlug === effectiveSearch.upstreamSlug,
      )
    : undefined;
  const tiers = searchOption?.searchTiers ?? [];

  return (
    <div className="expert-web">
      <p className="web-zk-note">
        The expert's web queries and fetched pages leave your device and are sent to the chosen
        provider via your proxy.
      </p>
      <WebInterfacingSection
        options={options}
        search={value.search}
        fetch={value.fetch}
        onChange={(next) => onChange({ ...value, search: next.search, fetch: next.fetch })}
      />
      <div className="web-field">
        <label htmlFor="expert-web-depth">Search depth</label>
        <div className="web-select-wrap">
          <select
            id="expert-web-depth"
            className="web-select"
            disabled={tiers.length === 0}
            value={value.searchTierId ?? tiers.find((t) => t.id === 'neural')?.id ?? tiers[0]?.id ?? ''}
            onChange={(e) => onChange({ ...value, searchTierId: e.target.value || null })}
          >
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
```

> **Implementer note:** confirm `WebBackendOption` carries `searchTiers` (it may need to be surfaced from the offering when options are built in `web-backend-options.ts`). If `searchTiers` is not on `WebBackendOption`, add it there (mapped from `offering.web.searchTiers`) — a small, behaviour-preserving addition the chat cockpit already needs elsewhere via `use-active-search-tiers.ts`. Verify against `lib/use-active-search-tiers.ts` how tiers are currently surfaced and reuse that path rather than re-deriving.

- [ ] **Step 4: Mount it in `settings.tsx`**

Near the existing `WebInterfacingSection` mount (line ~285), add the expert section, gated identically (proxy notice when no proxy), reading/writing `settings.data.expertWeb`:

```tsx
const ew = settings.data?.expertWeb ?? { search: null, fetch: null, searchTierId: null };
// inside an AccordionCard "Expert web access":
<ExpertWebSection
  options={webOptions}
  value={ew}
  onChange={(next) => update.mutate({ expertWeb: next })}
/>
```

Place it inside the same proxy-gating conditional the chat web section uses. Use an `AccordionCard` wrapper to match the surrounding sections.

- [ ] **Step 5: Run the test + the settings suite**

Run: `pnpm --filter @chatsundere/user-client test expert-web-section settings`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/components/ExpertWebSection.tsx apps/user-client/src/routes/app/settings.tsx apps/user-client/src/lib/web-backend-options.ts apps/user-client/tests/components/expert-web-section.test.tsx
git commit -m "Add the Expert web access settings section"
```

---

## Task 12: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (14/14).

- [ ] **Step 2: Full user-client vitest**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: PASS except the known `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline (verify the failing files are exactly those three and that they fail identically on `master` — per CLAUDE.md §10 and `feedback_per_task_review_runs_full_suite`).

- [ ] **Step 3: llm-unified tests (sanity — no logic changed there, but the type is consumed)**

Run: `pnpm --filter @chatsundere/llm-unified test`
Expected: PASS (unchanged baseline).

- [ ] **Step 4: Build**

Run: `pnpm run build`
Expected: PASS (9/9).

- [ ] **Step 5: Biome**

Run: `pnpm biome check apps/user-client/src packages/llm-unified/src`
Expected: clean (auto-fix + re-stage if needed).

---

## Task 13: Docs — security-deferrals + STATUS

**Files:**
- Modify: `obsidian/insights/security-deferrals.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Log the new egress in security-deferrals**

Append an entry: the expert uplink can now issue `web_search`/`web_fetch` via the user's CORS proxy to the chosen web backend (exa+neural by default). New outbound surface analogous to chat web egress + the existing ask_expert egress; client-only; queries derive solely from the already-sanitised standalone question; no auth/sync/proxy/crypto code touched (not a Larissa change).

- [ ] **Step 2: Update STATUS-CLIENT-ONLY.md**

Add a top entry summarising the landed feature (author default reasoning; expert web access with exa+neural default + visible pill; SubagentBase + buildWebTools unification; Dexie v17). Note it is squashed-but-not-pushed (Chris pushes). Update `Last updated:` and the "Next" block. Move nothing into "Briefed" (this is shipped).

- [ ] **Step 3: Commit (doc-only)**

```bash
git add obsidian/insights/security-deferrals.md obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Record subagent improvements in STATUS + security-deferrals [skip ci]"
```

> **Note:** STATUS update + security-deferrals are doc-only → `[skip ci]`. The squash of the code tasks into one feature-unit commit is Liz's responsibility (subagents never squash/push). Per CLAUDE.md §8, squash Tasks 1-12 into one commit "Improve subagents: author reasoning, expert web access, base unification" before recording. Verify `git diff master..<branch>` is empty after squash (full-tree capture, `feedback_verify_worktree_squash_captured_full_tree`).

---

## Self-Review notes (addressed)

- **Spec coverage:** (a) → Task 2; (b) settings/migration → Task 5; (b) resolution → Task 6; (b) shared builders → Task 3; (b) loop → Task 7; (b) wiring → Task 8; (b) pill → Task 10; (b) settings UI → Task 11; (c) base → Task 1, builders → Task 3, no-engine decision → recorded in spec §6/D5; isolation → Task 9; egress → Task 13; tests → throughout + Task 12.
- **Ordering:** topological over the import graph (`feedback_plan_order_by_import_dependency`) — types/pure fns (1, 3, 4) before consumers (5-8), UI/tests last. Task 4 (ToolProgress) must precede Task 3 Step 3's compile; noted inline.
- **Type consistency:** `SubagentBase` (Task 1) used in Tasks 2/6/7; `ResolvedSearch`/`ResolvedFetch`/`BuildWebToolsInput` (Task 3) used in 6/8; `ExpertWeb` (Task 7) used in 8; `ResolvedExpertWeb` (Task 6) used in 8; `EXPERT_MAX_ROUNDS = 8` (Task 8) — single source.
- **British-English UI:** flagged explicitly in Task 10 (ship "searching the web"/"reading", not the German placeholders used illustratively).
- **Known risks called out:** `dispatch`/`toolDefs` import cycle (Task 7 Step 4 → `tool-defs.ts`); `WebBackendOption.searchTiers` surfacing (Task 11 note); `webOptions` shape reuse (Task 8 note).
