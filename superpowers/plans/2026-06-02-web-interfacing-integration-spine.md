# Web-Interfacing Integration Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dormant *integration spine* — a first-class `Integration`
abstraction (counterpart to `Tool`) — with web interfacing (`web_search` +
`web_fetch`) as its first case, wired and gated but provider-less, so the only
remaining work to go live is writing the nano-gpt web adapter.

**Architecture:** Capability metadata on the `Offering` (curated facts);
behaviour on a `WebInterfacingProvider` adapter resolved through a
`web-adapter-registry` (empty today). The tool registry composes static tools
(`calculate_js`) + tools contributed by active integrations. Per-send
`IntegrationContext` (NSFW from the persona, location, selected offerings,
credential-bus `getKey`) drives which tools are offered. At zero `web` offerings
everything sleeps and `calculate_js` flows exactly as today.

**Tech Stack:** TypeScript (strict), Bun test (llm-unified), Vitest
(user-client), Dexie, Zustand, TanStack Query, React 18. Monorepo via pnpm +
Turborepo.

**Spec:** `superpowers/specs/2026-06-02-web-interfacing-integration-spine-design.md`

---

## Operating rules for the overnight worker (READ FIRST)

This repo carries strict conventions (project `CLAUDE.md` + the superpowers
skillset). They are normally implicit; because you execute without the lead's
session context, they are made explicit here. Follow them exactly.

1. **British English everywhere** in the repo — code, comments, identifiers,
   commit messages, log strings, error messages, tests. No exceptions. (`colour`,
   `behaviour`, `initialise`, `licence`.)
2. **TDD per task.** Each task is: write the failing test → run it, confirm it
   fails for the expected reason → write the minimal implementation → run it,
   confirm it passes → commit. Never write implementation before a failing test.
3. **Execution discipline.** Use `superpowers:subagent-driven-development`: one
   fresh subagent per task, followed by two-stage review (a spec-conformance
   review and a code-quality review) before moving on. **Subagents never merge,
   push, or switch branches** — those stay with the lead.
4. **Full verification, not just touched dirs.** A per-task review that only runs
   the touched test directory has repeatedly missed regressions in this repo.
   The final verification (Task 10) MUST run the **full** user-client Vitest
   suite, the full llm-unified Bun suite, `pnpm typecheck`, and `pnpm run build`.
5. **Known-green baseline.** The user-client Vitest suite has **8 pre-existing
   failures** across `cockpit-draft` / `chat-page` / `chat-route` (a
   localStorage-jsdom harness issue, unrelated to this work). Before claiming a
   regression, confirm the failure set is identical on `master`. Do not chase
   these 8; do not let your changes add a 9th.
6. **`pnpm typecheck` is the CI gate** (it covers tests too) — run it after any
   schema/type change, not just `build`. Build verification is `pnpm run build`
   (full TS pipeline), which diverges subtly from typecheck; run both at the end.
7. **Larissa security gate: NOT triggered.** This work is client-only +
   `llm-unified`; it touches no `apps/auth-service`, `apps/sync-service`,
   `apps/proxy-service`, or `packages/crypto`. No audit needed. (Task 10 records
   the *planned* outbound surface for the future adapter in the security journal —
   that is documentation, not an audit.)
8. **Squash discipline + branch.** Work on a feature branch
   `feat/web-interfacing-spine`. Make small TDD commits per step as you go; the
   lead squashes to one feature commit. **Do NOT merge to `master` and do NOT
   push.** Leave the branch for Chris to device-test and integrate.
9. **Co-author tag** on every commit:
   `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
10. **No new `any`** without an inline comment explaining why. `strict: true`,
    `noUncheckedIndexedAccess: true`. Every package-public function gets a
    one-line JSDoc. Comments explain non-obvious *why*, never restate *what*.
11. **Commands** (run from repo root `/home/chris/workspace/chatsundere`):
    - llm-unified tests: `cd packages/llm-unified && bun test` (or a single file:
      `bun test src/integrations/web-adapter-registry.test.ts`)
    - user-client tests: `pnpm --filter @chatsundere/user-client test`
      (single file: `pnpm --filter @chatsundere/user-client test -- src/integrations/web/web-integration.test.ts`)
    - typecheck: `pnpm typecheck`
    - build: `pnpm run build`
12. **End-of-run STATUS update** (Task 10): update
    `obsidian/STATUS-CLIENT-ONLY.md` per the project's STATUS protocol — move this
    work into "Done", refresh the "Next session" block (next = the nano-gpt web
    adapter), update the `Last updated:` line.

---

## File structure

**`packages/llm-unified/src/`**
- `integrations/web-interfacing.ts` — *new.* Web type contracts: `WebContext`,
  `WebLocation`, `WebSearchHit`, `WebSearchResult`, `WebFetchResult`,
  `WebQualityClass`, `WebOfferingMeta`, `WebInterfacingProvider`.
- `integrations/web-adapter-registry.ts` — *new.* `registerWebAdapter`,
  `resolveWebAdapter`, `_resetWebAdapterRegistryForTests`.
- `integrations/web-adapter-registry.test.ts` — *new.*
- `catalogue/types.ts` — *modify.* Add optional `web?: WebOfferingMeta` to
  `Offering`.
- `index.ts` — *modify.* Re-export the new web types + registry functions.

**`apps/user-client/src/`**
- `integrations/types.ts` — *new.* `OfferingRef`, `IntegrationContext`,
  `Integration`.
- `integrations/web/web-integration.ts` — *new.* `createWebIntegration(deps)` +
  default `webIntegration`; owns `web_search` / `web_fetch`.
- `integrations/web/web-integration.test.ts` — *new.*
- `integrations/build-context.ts` — *new.* `buildIntegrationContext(...)`.
- `integrations/build-context.test.ts` — *new.*
- `integrations/index.ts` — *new.* The `INTEGRATIONS` array.
- `tools/registry.ts` — *modify.* Compose static + active-integration tools;
  signatures of `toolDefs`/`systemPromptSegment`/`dispatch` now take a `Tool[]`.
- `tools/registry.test.ts` — *new.*
- `boot/client-data-db.ts` — *modify.* `SettingsRow.webInterfacing` + Dexie v11
  migration + seed default.
- `boot/client-data-db.webinterfacing.test.ts` — *new.*
- `state/stream-manager.store.ts` — *modify.* Build `IntegrationContext`, derive
  active tools, pass through to the loop.
- `data/send-message.ts` — *modify.* Thread `webInterfacing` from settings into
  `start` / `regenerate` args.
- `lib/web-backend-options.ts` — *new.* Pure helper: usable template ids →
  selectable web-backend options (for the settings UI).
- `lib/web-backend-options.test.ts` — *new.*
- `components/WebInterfacingSection.tsx` — *new.* The functional (unstyled)
  settings section.
- `components/WebInterfacingSection.test.tsx` — *new.*
- `routes/app/settings.tsx` — *modify.* Render `WebInterfacingSection` only when
  the `web` modality is lit.

---

## Task 1: Web type contracts (llm-unified)

**Files:**
- Create: `packages/llm-unified/src/integrations/web-interfacing.ts`
- Modify: `packages/llm-unified/src/catalogue/types.ts:37`
- Modify: `packages/llm-unified/src/index.ts`

This task is **type-only** (interfaces have no runtime behaviour to TDD). The
test that proves it compiles + is wired is Task 2 (the registry consumes these
types). Verify with `pnpm typecheck` at the end of this task.

- [ ] **Step 1: Create the web type contracts**

```ts
// packages/llm-unified/src/integrations/web-interfacing.ts
// SPDX-License-Identifier: LGPL-3.0-only

/** A coarse, curated geographic hint passed to web backends that localise
 *  results. Shape only; its source on the client is a deferred follow-up. */
export interface WebLocation {
  country?: string;
  region?: string;
  city?: string;
}

/** The per-call context a web backend may use: whether explicit content is
 *  permitted (driven by the active persona) and an optional location hint. */
export interface WebContext {
  nsfwAllowed: boolean;
  location: WebLocation | null;
}

/** One result row from a web search. */
export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** The outcome of a web search, serialised by the tool for the model. */
export interface WebSearchResult {
  query: string;
  hits: WebSearchHit[];
}

/** The outcome of fetching a single URL. `content` is model-ready text
 *  (markdown for `ai-friendly` backends, plainer text for `classic`). */
export interface WebFetchResult {
  url: string;
  content: string;
}

/** Quality tier of a web backend: `classic` is 2002-style keyword search
 *  (Kagi, Brave); `ai-friendly` returns model-optimised content (Exa, Linkup). */
export type WebQualityClass = 'classic' | 'ai-friendly';

/** Curated capability metadata for a `web` offering — the single source of
 *  truth for what a backend can do and how good it is for an LLM. Lives on the
 *  offering (catalogue knowledge), not on the adapter. */
export interface WebOfferingMeta {
  canSearch: boolean;
  canFetch: boolean;
  qualityClass: WebQualityClass;
}

/** Behavioural contract a web-interfacing adapter implements. A backend exposes
 *  only the methods it supports; capability flags live on the offering's
 *  `web` metadata, not here. The key is supplied per call (never stored). */
export interface WebInterfacingProvider {
  search?(
    query: string,
    ctx: WebContext,
    key: string,
    signal?: AbortSignal,
  ): Promise<WebSearchResult>;
  fetch?(url: string, ctx: WebContext, key: string, signal?: AbortSignal): Promise<WebFetchResult>;
}
```

- [ ] **Step 2: Add the optional `web` block to `Offering`**

In `packages/llm-unified/src/catalogue/types.ts`, add the import and the field.
At the top of the file (with the other imports / type declarations), import the
metadata type:

```ts
import type { WebOfferingMeta } from '../integrations/web-interfacing.js';
```

Then inside `interface Offering { ... }` (currently ending at line 49 with
`serviceKind: ServiceKind;`), add as the final member:

```ts
  /** Capability metadata when `serviceKind === 'web'`; undefined for `llm`. */
  web?: WebOfferingMeta;
```

- [ ] **Step 3: Re-export from the package index**

In `packages/llm-unified/src/index.ts`, add (near the other catalogue/type
exports):

```ts
export type {
  WebLocation,
  WebContext,
  WebSearchHit,
  WebSearchResult,
  WebFetchResult,
  WebQualityClass,
  WebOfferingMeta,
  WebInterfacingProvider,
} from './integrations/web-interfacing.js';
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (13/13 projects). The new optional `web?` field must not break
any existing offering construction (it is optional).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/integrations/web-interfacing.ts \
        packages/llm-unified/src/catalogue/types.ts \
        packages/llm-unified/src/index.ts
git commit -m "Add web-interfacing type contracts + offering web metadata

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Web adapter registry (llm-unified)

**Files:**
- Create: `packages/llm-unified/src/integrations/web-adapter-registry.ts`
- Create: `packages/llm-unified/src/integrations/web-adapter-registry.test.ts`
- Modify: `packages/llm-unified/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/llm-unified/src/integrations/web-adapter-registry.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it } from 'bun:test';
import type { WebInterfacingProvider } from './web-interfacing.js';
import {
  _resetWebAdapterRegistryForTests,
  registerWebAdapter,
  resolveWebAdapter,
} from './web-adapter-registry.js';

describe('web-adapter-registry', () => {
  afterEach(() => _resetWebAdapterRegistryForTests());

  it('returns null for an unregistered adapter id (empty today)', () => {
    expect(resolveWebAdapter('nano-gpt-brave')).toBeNull();
  });

  it('resolves a registered adapter via its factory', () => {
    const fake: WebInterfacingProvider = {
      search: async (query) => ({ query, hits: [] }),
    };
    registerWebAdapter('nano-gpt-brave', () => fake);
    expect(resolveWebAdapter('nano-gpt-brave')).toBe(fake);
  });

  it('reset clears all registrations', () => {
    registerWebAdapter('x', () => ({}));
    _resetWebAdapterRegistryForTests();
    expect(resolveWebAdapter('x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/integrations/web-adapter-registry.test.ts`
Expected: FAIL — module `./web-adapter-registry.js` does not exist.

- [ ] **Step 3: Write the registry**

```ts
// packages/llm-unified/src/integrations/web-adapter-registry.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { WebInterfacingProvider } from './web-interfacing.js';

/** A factory producing a web-interfacing adapter instance. */
export type WebAdapterFactory = () => WebInterfacingProvider;

const REGISTRY = new Map<string, WebAdapterFactory>();

/** Register a web adapter under a catalogue adapter id. Called at curation /
 *  bootstrap time (no registrations exist yet — the spine is dormant). */
export function registerWebAdapter(adapterId: string, factory: WebAdapterFactory): void {
  REGISTRY.set(adapterId, factory);
}

/** Resolve a web adapter by id, or `null` when none is registered. */
export function resolveWebAdapter(adapterId: string): WebInterfacingProvider | null {
  const factory = REGISTRY.get(adapterId);
  return factory ? factory() : null;
}

/** Test-only — clears registry state. */
export function _resetWebAdapterRegistryForTests(): void {
  REGISTRY.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/integrations/web-adapter-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Re-export from the package index**

In `packages/llm-unified/src/index.ts` add:

```ts
export {
  registerWebAdapter,
  resolveWebAdapter,
  _resetWebAdapterRegistryForTests,
  type WebAdapterFactory,
} from './integrations/web-adapter-registry.js';
```

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add packages/llm-unified/src/integrations/web-adapter-registry.ts \
        packages/llm-unified/src/integrations/web-adapter-registry.test.ts \
        packages/llm-unified/src/index.ts
git commit -m "Add web-adapter-registry (empty until a backend is curated)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Integration types (user-client)

**Files:**
- Create: `apps/user-client/src/integrations/types.ts`

Type-only task; verified by `pnpm typecheck` and consumed by Tasks 4–5.

- [ ] **Step 1: Create the integration types**

```ts
// apps/user-client/src/integrations/types.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ServiceKind, WebLocation } from '@chatsundere/llm-unified';
import type { Tool } from '../tools/types.js';

/** A reference to a specific offering. Offerings have no single id — they are
 *  keyed by their provider + upstream slug (see `getOffering`). */
export interface OfferingRef {
  providerId: string;
  upstreamSlug: string;
}

/** Everything an integration needs to decide which tools to contribute and how
 *  to execute them, assembled per send by the stream-manager. */
export interface IntegrationContext {
  /** Explicit content permitted — from the active persona's adultPersona flag. */
  nsfwAllowed: boolean;
  /** Optional location hint; shape defined, source deferred (null today). */
  location: WebLocation | null;
  /** Selected web search backend, or null when none chosen. */
  webSearch: OfferingRef | null;
  /** Selected web fetch backend, independently chosen, or null. */
  webFetch: OfferingRef | null;
  /** Retrieve a provider's plaintext key at call time — credential-bus,
   *  MasterKey-gated. Returns null when no key / no master key. */
  getKey: (providerTemplateId: string) => Promise<string | null>;
}

/** A dynamic, credential-gated capability unit — the counterpart to a static
 *  `Tool`. Identified by capability (a single `ServiceKind`), never by provider:
 *  one integration per capability, into which providers plug. Contributes 0..n
 *  tools depending on runtime configuration. */
export interface Integration {
  readonly id: string;
  readonly capability: ServiceKind;
  /** Active tools for this context; `[]` when the capability is not configured. */
  contributesTools(ctx: IntegrationContext): Tool[];
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/integrations/types.ts
git commit -m "Add Integration + IntegrationContext + OfferingRef types

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: The WebInterfacing integration (user-client)

**Files:**
- Create: `apps/user-client/src/integrations/web/web-integration.ts`
- Create: `apps/user-client/src/integrations/web/web-integration.test.ts`
- Create: `apps/user-client/src/integrations/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/integrations/web/web-integration.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering, WebInterfacingProvider } from '@chatsundere/llm-unified';
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationContext, OfferingRef } from '../types.js';
import { createWebIntegration } from './web-integration.js';

const REF: OfferingRef = { providerId: 'nano-gpt', upstreamSlug: 'brave' };

function webOffering(meta: Offering['web']): Offering {
  return {
    canonicalRef: null,
    providerId: 'nano-gpt',
    upstreamSlug: 'brave',
    adapter: { kind: 'catalogue', adapterId: 'nano-gpt-brave' },
    // biome-ignore lint/suspicious/noExplicitAny: profile is irrelevant to web gating in this unit test
    profile: {} as any,
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: null,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'web',
    web: meta,
  };
}

function ctx(over: Partial<IntegrationContext>): IntegrationContext {
  return {
    nsfwAllowed: false,
    location: null,
    webSearch: null,
    webFetch: null,
    getKey: async () => 'secret-key',
    ...over,
  };
}

describe('web-integration', () => {
  it('contributes nothing when no offerings are selected', () => {
    const integ = createWebIntegration({
      getOffering: () => undefined,
      resolveWebAdapter: () => null,
    });
    expect(integ.contributesTools(ctx({}))).toEqual([]);
  });

  it('contributes nothing when no adapter resolves (dormant — today)', () => {
    const integ = createWebIntegration({
      getOffering: () => webOffering({ canSearch: true, canFetch: true, qualityClass: 'classic' }),
      resolveWebAdapter: () => null, // registry empty
    });
    expect(integ.contributesTools(ctx({ webSearch: REF, webFetch: REF }))).toEqual([]);
  });

  it('contributes only web_search when the backend can search but not fetch', () => {
    const provider: WebInterfacingProvider = { search: async (q) => ({ query: q, hits: [] }) };
    const integ = createWebIntegration({
      getOffering: () => webOffering({ canSearch: true, canFetch: false, qualityClass: 'ai-friendly' }),
      resolveWebAdapter: () => provider,
    });
    const tools = integ.contributesTools(ctx({ webSearch: REF, webFetch: REF }));
    expect(tools.map((t) => t.name)).toEqual(['web_search']);
  });

  it('web_search.execute pulls the key and serialises hits', async () => {
    const search = vi.fn(async (q: string) => ({
      query: q,
      hits: [{ title: 'T', url: 'https://e.x', snippet: 'S' }],
    }));
    const getKey = vi.fn(async () => 'secret-key');
    const integ = createWebIntegration({
      getOffering: () => webOffering({ canSearch: true, canFetch: false, qualityClass: 'classic' }),
      resolveWebAdapter: () => ({ search }),
    });
    const [tool] = integ.contributesTools(ctx({ webSearch: REF, getKey }));
    const result = await tool!.execute({ query: 'cats' });
    expect(getKey).toHaveBeenCalledWith('nano-gpt');
    expect(search).toHaveBeenCalledWith('cats', { nsfwAllowed: false, location: null }, 'secret-key', undefined);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('https://e.x');
  });

  it('web_search.execute fails gracefully when no key is available', async () => {
    const integ = createWebIntegration({
      getOffering: () => webOffering({ canSearch: true, canFetch: false, qualityClass: 'classic' }),
      resolveWebAdapter: () => ({ search: async (q) => ({ query: q, hits: [] }) }),
    });
    const [tool] = integ.contributesTools(ctx({ webSearch: REF, getKey: async () => null }));
    const result = await tool!.execute({ query: 'cats' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- src/integrations/web/web-integration.test.ts`
Expected: FAIL — `./web-integration.js` does not exist.

- [ ] **Step 3: Write the integration**

```ts
// apps/user-client/src/integrations/web/web-integration.ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Offering,
  type WebContext,
  type WebFetchResult,
  type WebInterfacingProvider,
  type WebSearchResult,
  getOffering as realGetOffering,
  resolveWebAdapter as realResolveWebAdapter,
} from '@chatsundere/llm-unified';
import type { Tool, ToolResult } from '../../tools/types.js';
import type { Integration, IntegrationContext, OfferingRef } from '../types.js';

/** Injectable resolvers so the integration is unit-testable without the live
 *  catalogue/registry. */
export interface WebIntegrationDeps {
  getOffering: (providerId: string, upstreamSlug: string) => Offering | undefined;
  resolveWebAdapter: (adapterId: string) => WebInterfacingProvider | null;
}

interface Resolved {
  offering: Offering;
  provider: WebInterfacingProvider;
}

function toWebContext(ctx: IntegrationContext): WebContext {
  return { nsfwAllowed: ctx.nsfwAllowed, location: ctx.location };
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

/** Build the WebInterfacing integration over injectable resolvers. The default
 *  `webIntegration` wires the real catalogue + registry. */
export function createWebIntegration(deps: WebIntegrationDeps): Integration {
  const resolve = (ref: OfferingRef | null): Resolved | null => {
    if (!ref) return null;
    const offering = deps.getOffering(ref.providerId, ref.upstreamSlug);
    if (!offering || offering.serviceKind !== 'web' || !offering.web) return null;
    if (offering.adapter.kind !== 'catalogue') return null;
    const provider = deps.resolveWebAdapter(offering.adapter.adapterId);
    return provider ? { offering, provider } : null;
  };

  return {
    id: 'web-interfacing',
    capability: 'web',
    contributesTools(ctx: IntegrationContext): Tool[] {
      const tools: Tool[] = [];

      const searchR = resolve(ctx.webSearch);
      if (searchR && searchR.offering.web?.canSearch && searchR.provider.search) {
        const { offering, provider } = searchR;
        tools.push({
          name: 'web_search',
          description:
            'Search the web for current information. Returns a ranked list of results with titles, URLs and snippets.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'The search query.' } },
            required: ['query'],
          },
          systemPromptInstruction:
            'You can search the web with web_search when you need current or external information.',
          async execute(args, signal): Promise<ToolResult> {
            const key = await ctx.getKey(offering.providerId);
            if (!key) return { ok: false, output: '', error: 'No API key for the web search backend.' };
            const query = typeof args.query === 'string' ? args.query : '';
            // biome-ignore lint/style/noNonNullAssertion: gated above — provider.search is defined
            const result = await provider.search!(query, toWebContext(ctx), key, signal);
            return { ok: true, output: formatSearch(result), error: null };
          },
        });
      }

      const fetchR = resolve(ctx.webFetch);
      if (fetchR && fetchR.offering.web?.canFetch && fetchR.provider.fetch) {
        const { offering, provider } = fetchR;
        tools.push({
          name: 'web_fetch',
          description: 'Fetch and read the contents of a specific URL.',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: 'The absolute URL to fetch.' } },
            required: ['url'],
          },
          systemPromptInstruction:
            'You can read a specific page with web_fetch when you have a URL to inspect.',
          async execute(args, signal): Promise<ToolResult> {
            const key = await ctx.getKey(offering.providerId);
            if (!key) return { ok: false, output: '', error: 'No API key for the web fetch backend.' };
            const url = typeof args.url === 'string' ? args.url : '';
            // biome-ignore lint/style/noNonNullAssertion: gated above — provider.fetch is defined
            const result = await provider.fetch!(url, toWebContext(ctx), key, signal);
            return { ok: true, output: formatFetch(result), error: null };
          },
        });
      }

      return tools;
    },
  };
}

/** The application's WebInterfacing integration, wired to the live catalogue and
 *  the (currently empty) web-adapter-registry. Dormant until a backend is
 *  curated and its adapter registered. */
export const webIntegration = createWebIntegration({
  getOffering: realGetOffering,
  resolveWebAdapter: realResolveWebAdapter,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- src/integrations/web/web-integration.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Create the integrations index**

```ts
// apps/user-client/src/integrations/index.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { Integration } from './types.js';
import { webIntegration } from './web/web-integration.js';

/** Every registered integration. Each contributes 0..n tools per context. */
export const INTEGRATIONS: readonly Integration[] = [webIntegration];
```

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add apps/user-client/src/integrations/web/web-integration.ts \
        apps/user-client/src/integrations/web/web-integration.test.ts \
        apps/user-client/src/integrations/index.ts
git commit -m "Add WebInterfacing integration (dormant — no backend yet)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Evolve the tool registry to compose static + integration tools

**Files:**
- Modify: `apps/user-client/src/tools/registry.ts`
- Create: `apps/user-client/src/tools/registry.test.ts`

The registry currently exposes parameterless `toolDefs()` / `systemPromptSegment()`
/ `dispatch(name, args, signal)` over a static `TOOLS` array. They become pure
functions over an explicit `Tool[]`, plus a new `resolveActiveTools(ctx)` that
composes static tools + active-integration tools.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/tools/registry.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { IntegrationContext } from '../integrations/types.js';
import { dispatch, resolveActiveTools, systemPromptSegment, toolDefs } from './registry.js';
import type { Tool } from './types.js';

const fakeTool: Tool = {
  name: 'echo',
  description: 'Echo',
  parameters: { type: 'object', properties: {} },
  systemPromptInstruction: 'Use echo to repeat.',
  execute: async (args) => ({ ok: true, output: String(args.text ?? ''), error: null }),
};

const dormantCtx: IntegrationContext = {
  nsfwAllowed: false,
  location: null,
  webSearch: null,
  webFetch: null,
  getKey: async () => null,
};

describe('tool registry composition', () => {
  it('always includes calculate_js and contributes nothing web-side when dormant', () => {
    const tools = resolveActiveTools(dormantCtx);
    expect(tools.map((t) => t.name)).toEqual(['calculate_js']);
  });

  it('toolDefs projects each tool to its wire definition', () => {
    const defs = toolDefs([fakeTool]);
    expect(defs).toEqual([
      { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } },
    ]);
  });

  it('systemPromptSegment joins non-null instructions, or null when empty', () => {
    expect(systemPromptSegment([fakeTool])).toContain('Use echo');
    expect(systemPromptSegment([{ ...fakeTool, systemPromptInstruction: null }])).toBeNull();
  });

  it('dispatch routes by name and returns a structured error for unknown tools', async () => {
    const ok = await dispatch([fakeTool], 'echo', { text: 'hi' });
    expect(ok).toEqual({ ok: true, output: 'hi', error: null });
    const miss = await dispatch([fakeTool], 'nope', {});
    expect(miss.ok).toBe(false);
    expect(miss.error).toContain('Unknown tool');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- src/tools/registry.test.ts`
Expected: FAIL — `resolveActiveTools` is not exported; `toolDefs`/`dispatch`
signatures differ.

- [ ] **Step 3: Rewrite the registry**

Replace the entire contents of `apps/user-client/src/tools/registry.ts` with:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ToolDef } from '@chatsundere/llm-unified';
import { INTEGRATIONS } from '../integrations/index.js';
import type { IntegrationContext } from '../integrations/types.js';
import { calculateJs } from './calculate-js.js';
import type { Tool, ToolResult } from './types.js';

/** Always-on tools (omakase — no per-tool toggle). */
const STATIC_TOOLS: readonly Tool[] = [calculateJs];

/** The active tool set for this send: static tools plus every tool each
 *  integration contributes for the given context. At zero configured
 *  integrations this is exactly `STATIC_TOOLS`. */
export function resolveActiveTools(ctx: IntegrationContext): Tool[] {
  return [...STATIC_TOOLS, ...INTEGRATIONS.flatMap((i) => i.contributesTools(ctx))];
}

/** Wire tool definitions for the given active tools. */
export function toolDefs(tools: Tool[]): ToolDef[] {
  return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** Joined non-null `systemPromptInstruction`s for the Band-3 tools segment, or
 *  `null` when nothing to add. */
export function systemPromptSegment(tools: Tool[]): string | null {
  const lines = tools.map((t) => t.systemPromptInstruction).filter((s): s is string => s !== null);
  return lines.length > 0 ? lines.join('\n\n') : null;
}

/** Execute a tool by name within the given active set. An unknown name returns a
 *  structured error rather than throwing — a model can hallucinate a tool name. */
export function dispatch(
  tools: Tool[],
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return Promise.resolve({ ok: false, output: '', error: `Unknown tool: ${name}` });
  }
  return tool.execute(args, signal);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- src/tools/registry.test.ts`
Expected: PASS (4 tests). (The stream-manager call site is updated in Task 8 —
typecheck will fail until then; that is expected and resolved in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/tools/registry.ts apps/user-client/src/tools/registry.test.ts
git commit -m "Compose tool registry from static tools + active integrations

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: Dexie v11 — webInterfacing on SettingsRow

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/src/boot/client-data-db.webinterfacing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/boot/client-data-db.webinterfacing.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from './client-data-db.js';

describe('settings.webInterfacing (Dexie v11)', () => {
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('seeds the settings singleton with an empty webInterfacing block', async () => {
    const db = await openClientDataDb();
    const settings = await db.settings.get(1);
    expect(settings?.webInterfacing).toEqual({ search: null, fetch: null });
  });

  it('is at version 11', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- src/boot/client-data-db.webinterfacing.test.ts`
Expected: FAIL — `webInterfacing` is undefined and `verno` is 10.

- [ ] **Step 3: Implement the field, migration, and seed default**

In `apps/user-client/src/boot/client-data-db.ts`:

(a) Add the import near the top (the `OfferingRef` type lives in the integrations
module):

```ts
import type { OfferingRef } from '../integrations/types.js';
```

(b) Add the field to `interface SettingsRow` (after `corsProxy`, line ~20):

```ts
  webInterfacing: { search: OfferingRef | null; fetch: OfferingRef | null };
```

(c) Add the v11 migration immediately after the v10 block (after line 360, before
the closing brace of the constructor at line 361):

```ts
    // Version 11 — web-interfacing integration spine. Settings gain a
    // non-indexed `webInterfacing` block selecting the web search/fetch
    // backends (both null until the user configures them).
    this.version(11)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
        personaAvatars: 'personaId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            s.webInterfacing = { search: null, fetch: null };
          });
      });
```

(d) Add the seed default in `seedBuiltinsIfNeeded` — in the
`db.settings.add({ ... })` object (after `corsProxy: null,`, line ~468):

```ts
        webInterfacing: { search: null, fetch: null },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- src/boot/client-data-db.webinterfacing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Check the broader db test suite for verno assertions**

Run: `pnpm --filter @chatsundere/user-client test -- src/boot`
Expected: PASS. If an existing db test asserts a specific `verno` (the
persona-settings work bumped 9→10), update that assertion 10→11. Search for
`verno` and `version(` in any `src/boot/*.test.ts` and adjust to 11 where it
pins the latest version.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts \
        apps/user-client/src/boot/client-data-db.webinterfacing.test.ts
git commit -m "Add webInterfacing to settings (Dexie v11)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: buildIntegrationContext (user-client)

**Files:**
- Create: `apps/user-client/src/integrations/build-context.ts`
- Create: `apps/user-client/src/integrations/build-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/integrations/build-context.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildIntegrationContext } from './build-context.js';
import type { OfferingRef } from './types.js';

const REF: OfferingRef = { providerId: 'nano-gpt', upstreamSlug: 'brave' };
const fakeMk = {} as MasterKey;

describe('buildIntegrationContext', () => {
  it('maps persona nsfw flag and web settings into the context', () => {
    const ctx = buildIntegrationContext(
      { adultPersona: true },
      { search: REF, fetch: null },
      fakeMk,
      async () => 'k',
    );
    expect(ctx.nsfwAllowed).toBe(true);
    expect(ctx.location).toBeNull();
    expect(ctx.webSearch).toEqual(REF);
    expect(ctx.webFetch).toBeNull();
  });

  it('getKey delegates to the credential retriever with the master key', async () => {
    const getKeyFn = vi.fn(async () => 'secret');
    const ctx = buildIntegrationContext(
      { adultPersona: false },
      { search: null, fetch: null },
      fakeMk,
      getKeyFn,
    );
    await expect(ctx.getKey('nano-gpt')).resolves.toBe('secret');
    expect(getKeyFn).toHaveBeenCalledWith('nano-gpt', fakeMk);
  });

  it('getKey returns null when there is no master key', async () => {
    const getKeyFn = vi.fn(async () => 'secret');
    const ctx = buildIntegrationContext(
      { adultPersona: false },
      { search: null, fetch: null },
      null,
      getKeyFn,
    );
    await expect(ctx.getKey('nano-gpt')).resolves.toBeNull();
    expect(getKeyFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- src/integrations/build-context.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the context builder**

```ts
// apps/user-client/src/integrations/build-context.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { getCredentialKey } from '../credentials/credential-bus.js';
import type { IntegrationContext, OfferingRef } from './types.js';

/** The subset of the persona this builder reads. */
interface PersonaNsfw {
  adultPersona: boolean;
}

/** The web-interfacing settings block. */
interface WebSettings {
  search: OfferingRef | null;
  fetch: OfferingRef | null;
}

/**
 * Assemble the per-send IntegrationContext. NSFW comes from the active persona;
 * location is deferred (null today); the web backends come from settings; the
 * key accessor is MasterKey-gated via the credential bus and resolves keys only
 * at call time. `getKeyFn` is injectable for tests (defaults to the real bus).
 */
export function buildIntegrationContext(
  persona: PersonaNsfw,
  web: WebSettings,
  mk: MasterKey | null,
  getKeyFn: (id: string, mk: MasterKey) => Promise<string | null> = getCredentialKey,
): IntegrationContext {
  return {
    nsfwAllowed: persona.adultPersona,
    location: null,
    webSearch: web.search,
    webFetch: web.fetch,
    getKey: (providerTemplateId) => (mk ? getKeyFn(providerTemplateId, mk) : Promise.resolve(null)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- src/integrations/build-context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/integrations/build-context.ts \
        apps/user-client/src/integrations/build-context.test.ts
git commit -m "Add buildIntegrationContext (per-send NSFW/location/keys)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: Wire the stream-manager + send-message

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Modify: `apps/user-client/src/data/send-message.ts`

This is the seam that connects everything. After it, `pnpm typecheck` is green
again (Task 5's signature change is resolved here).

- [ ] **Step 1: Update the stream-manager imports**

In `apps/user-client/src/state/stream-manager.store.ts`, replace the registry
import (line 10) and add the new imports:

```ts
import { dispatch as dispatchTool, resolveActiveTools, systemPromptSegment, toolDefs } from '../tools/registry.js';
import { useSessionStore } from '@chatsundere/ui-shared';
import { buildIntegrationContext } from '../integrations/build-context.js';
import type { OfferingRef } from '../integrations/types.js';
```

- [ ] **Step 2: Extend `StartArgs` with the web selection**

The `StartArgs` type (line 27) currently omits `signal`/`onChunk` from
`StartStreamArgs` and adds `chatId`/`userText`. Add the web selection (optional,
defaults handled at the build site):

```ts
type StartArgs = Omit<StartStreamArgs, 'signal' | 'onChunk'> & {
  chatId: string;
  userText: string;
  /** The persona's selected web backends, from settings; absent = none. */
  webInterfacing?: { search: OfferingRef | null; fetch: OfferingRef | null };
};
```

- [ ] **Step 3: Build the context and derive active tools in `runIntoDraft`**

Replace the three tool-derivation lines (currently lines 214–216):

```ts
  const toolsActive = args.offering.profile.toolCalls.supported;
  const activeToolDefs = toolsActive ? toolDefs() : [];
  const toolsInstruction = toolsActive ? (systemPromptSegment() ?? '') : '';
```

with:

```ts
  const toolsActive = args.offering.profile.toolCalls.supported;
  const integrationCtx = buildIntegrationContext(
    args.persona,
    args.webInterfacing ?? { search: null, fetch: null },
    useSessionStore.getState().mk,
  );
  const activeTools = toolsActive ? resolveActiveTools(integrationCtx) : [];
  const activeToolDefs = toolDefs(activeTools);
  const toolsInstruction = systemPromptSegment(activeTools) ?? '';
```

- [ ] **Step 4: Update the dispatch call to pass the active set**

In the `runToolLoop({ ... })` call, replace the `dispatch` line (currently line
244):

```ts
    dispatch: (name, toolArgs, signal) => dispatchTool(name, toolArgs, signal),
```

with:

```ts
    dispatch: (name, toolArgs, signal) => dispatchTool(activeTools, name, toolArgs, signal),
```

- [ ] **Step 5: Thread `webInterfacing` from settings in send-message**

In `apps/user-client/src/data/send-message.ts`, inside `useSendMessage`'s
`mutationFn`, the settings row is needed. After resolving `chatId` and before the
`start(...)` call (around line 150), read settings and pass the block. Add:

```ts
      const settingsRow = await db.settings.get(1);
      const webInterfacing = settingsRow?.webInterfacing ?? { search: null, fetch: null };
```

Then add `webInterfacing,` to the object passed to
`useStreamManagerStore.getState().start({ ... })` (after `globalAboutMe:` at line
170).

Do the same in `useRegenerate` (further down the file): read the settings row and
pass `webInterfacing` into the `regenerate({ ... })` args. (The `RegenerateStreamArgs`
type extends `StartArgs`, so it already accepts the optional field — no type
change needed.)

- [ ] **Step 6: Typecheck + run the touched suites**

Run: `pnpm typecheck`
Expected: PASS (13/13) — Task 5's signature change is now resolved.

Run: `pnpm --filter @chatsundere/user-client test -- src/state/stream-manager.store.test.ts`
Expected: PASS. **If the test stub for `args` lacks `webInterfacing`**, it still
passes (the field is optional and defaults to `{ search: null, fetch: null }`).
If the stub's `offering` shape is stale, fix it to a real `Offering` (this repo
has hit that before — a stale `model` key masked by `as never`).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts apps/user-client/src/data/send-message.ts
git commit -m "Wire integration context + active tools into the stream loop

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 9: Web settings section (UI shell + visibility gating)

**Files:**
- Create: `apps/user-client/src/lib/web-backend-options.ts`
- Create: `apps/user-client/src/lib/web-backend-options.test.ts`
- Create: `apps/user-client/src/components/WebInterfacingSection.tsx`
- Create: `apps/user-client/src/components/WebInterfacingSection.test.tsx`
- Modify: `apps/user-client/src/routes/app/settings.tsx`

Functional, **unstyled** mechanics only — the opulent styling pass is a separate,
later round. Do not add glows/orbs/serif treatment here.

- [ ] **Step 1: Write the failing test for the pure options helper**

```ts
// apps/user-client/src/lib/web-backend-options.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ProviderDefinition } from '@chatsundere/llm-unified';
import { webBackendOptions } from './web-backend-options.js';

const provider = {
  id: 'nano-gpt',
  displayName: 'Nano-GPT',
  offerings: [
    {
      providerId: 'nano-gpt',
      upstreamSlug: 'brave',
      serviceKind: 'web',
      web: { canSearch: true, canFetch: true, qualityClass: 'classic' },
      canonicalRef: null,
      // biome-ignore lint/suspicious/noExplicitAny: only web fields matter here
    } as any,
    {
      providerId: 'nano-gpt',
      upstreamSlug: 'some-llm',
      serviceKind: 'llm',
      // biome-ignore lint/suspicious/noExplicitAny: non-web offering, ignored
    } as any,
  ],
} as unknown as ProviderDefinition;

describe('webBackendOptions', () => {
  it('returns only web offerings of usable providers, with metadata', () => {
    const opts = webBackendOptions(['nano-gpt'], (id) => (id === 'nano-gpt' ? provider : undefined));
    expect(opts).toEqual([
      {
        providerId: 'nano-gpt',
        providerName: 'Nano-GPT',
        upstreamSlug: 'brave',
        canSearch: true,
        canFetch: true,
        qualityClass: 'classic',
      },
    ]);
  });

  it('returns [] when no usable provider has a web offering', () => {
    const opts = webBackendOptions([], () => undefined);
    expect(opts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- src/lib/web-backend-options.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the pure helper**

```ts
// apps/user-client/src/lib/web-backend-options.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { type ProviderDefinition, getProvider } from '@chatsundere/llm-unified';

/** A selectable web backend for the settings pickers, flattened from the
 *  usable providers' `web` offerings. */
export interface WebBackendOption {
  providerId: string;
  providerName: string;
  upstreamSlug: string;
  canSearch: boolean;
  canFetch: boolean;
  qualityClass: 'classic' | 'ai-friendly';
}

/** Flatten the `web` offerings of the usable providers into selectable options.
 *  `lookup` is injectable for tests (defaults to the live registry). */
export function webBackendOptions(
  usableTemplateIds: string[],
  lookup: (id: string) => ProviderDefinition | undefined = getProvider,
): WebBackendOption[] {
  const options: WebBackendOption[] = [];
  for (const id of usableTemplateIds) {
    const provider = lookup(id);
    if (!provider) continue;
    for (const o of provider.offerings) {
      if (o.serviceKind !== 'web' || !o.web) continue;
      options.push({
        providerId: provider.id,
        providerName: provider.displayName,
        upstreamSlug: o.upstreamSlug,
        canSearch: o.web.canSearch,
        canFetch: o.web.canFetch,
        qualityClass: o.web.qualityClass,
      });
    }
  }
  return options;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- src/lib/web-backend-options.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing component test**

```tsx
// apps/user-client/src/components/WebInterfacingSection.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WebBackendOption } from '../lib/web-backend-options.js';
import { WebInterfacingSection } from './WebInterfacingSection.js';

const brave: WebBackendOption = {
  providerId: 'nano-gpt',
  providerName: 'Nano-GPT',
  upstreamSlug: 'brave',
  canSearch: true,
  canFetch: true,
  qualityClass: 'classic',
};

describe('WebInterfacingSection', () => {
  it('renders a search and a fetch picker fed from the options', () => {
    render(
      <WebInterfacingSection
        options={[brave]}
        search={null}
        fetch={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/search backend/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fetch backend/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Nano-GPT/).length).toBeGreaterThan(0);
  });

  it('emits the chosen search backend as an OfferingRef', () => {
    const onChange = vi.fn();
    render(
      <WebInterfacingSection options={[brave]} search={null} fetch={null} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText(/search backend/i), {
      target: { value: 'nano-gpt::brave' },
    });
    expect(onChange).toHaveBeenCalledWith({
      search: { providerId: 'nano-gpt', upstreamSlug: 'brave' },
      fetch: null,
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- src/components/WebInterfacingSection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement the section**

```tsx
// apps/user-client/src/components/WebInterfacingSection.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { OfferingRef } from '../integrations/types.js';
import type { WebBackendOption } from '../lib/web-backend-options.js';

interface WebInterfacingValue {
  search: OfferingRef | null;
  fetch: OfferingRef | null;
}

interface Props {
  options: WebBackendOption[];
  search: OfferingRef | null;
  fetch: OfferingRef | null;
  onChange: (next: WebInterfacingValue) => void;
}

const keyOf = (o: { providerId: string; upstreamSlug: string }): string =>
  `${o.providerId}::${o.upstreamSlug}`;

const refFromKey = (key: string): OfferingRef | null => {
  if (!key) return null;
  const [providerId, upstreamSlug] = key.split('::');
  return providerId && upstreamSlug ? { providerId, upstreamSlug } : null;
};

const labelFor = (o: WebBackendOption): string =>
  `${o.providerName} · ${o.upstreamSlug} (${o.qualityClass})`;

/**
 * Functional (unstyled) web-interfacing settings: two independent pickers for
 * the search and fetch backends. A backend that cannot serve a role is shown
 * disabled (disabled-over-hidden) with a title hint. Visibility of the whole
 * section is gated by the caller (only mounted when the `web` modality is lit).
 */
export function WebInterfacingSection({ options, search, fetch, onChange }: Props): JSX.Element {
  return (
    <section aria-label="Web interfacing">
      <h3>Web</h3>

      <label htmlFor="web-search-backend">Search backend</label>
      <select
        id="web-search-backend"
        value={search ? keyOf(search) : ''}
        onChange={(e) => onChange({ search: refFromKey(e.target.value), fetch })}
      >
        <option value="">None</option>
        {options.map((o) => (
          <option
            key={keyOf(o)}
            value={keyOf(o)}
            disabled={!o.canSearch}
            title={o.canSearch ? undefined : 'This backend cannot search'}
          >
            {labelFor(o)}
          </option>
        ))}
      </select>

      <label htmlFor="web-fetch-backend">Fetch backend</label>
      <select
        id="web-fetch-backend"
        value={fetch ? keyOf(fetch) : ''}
        onChange={(e) => onChange({ search, fetch: refFromKey(e.target.value) })}
      >
        <option value="">None</option>
        {options.map((o) => (
          <option
            key={keyOf(o)}
            value={keyOf(o)}
            disabled={!o.canFetch}
            title={o.canFetch ? undefined : 'This backend cannot fetch'}
          >
            {labelFor(o)}
          </option>
        ))}
      </select>
    </section>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- src/components/WebInterfacingSection.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Mount the section in settings, gated on the `web` modality**

In `apps/user-client/src/routes/app/settings.tsx`, the `ProvidersSection`
component already computes `const lit = aggregateServiceKinds(usable);` (line 92).
Mount the new section near it, only when web is lit. You will need: the usable
template ids (already available as `usable` in `ProvidersSection`, or via
`useUsableTemplateIds()`), the settings row (`useSettings()`), the update mutation
(`useUpdateSettings()`), and `webBackendOptions`.

Add the imports:

```ts
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { useUsableTemplateIds } from '../../lib/usable-providers.js';
import { webBackendOptions } from '../../lib/web-backend-options.js';
import { WebInterfacingSection } from '../../components/WebInterfacingSection.js';
```

Add a wrapper component that owns the data wiring (so the section component stays
pure and testable):

```tsx
function WebInterfacingSettings(): JSX.Element | null {
  const usable = useUsableTemplateIds();
  const settings = useSettings();
  const update = useUpdateSettings();
  if (!aggregateServiceKinds(usable).includes('web')) return null; // hidden until unlocked
  const wi = settings.data?.webInterfacing ?? { search: null, fetch: null };
  return (
    <WebInterfacingSection
      options={webBackendOptions(usable)}
      search={wi.search}
      fetch={wi.fetch}
      onChange={(next) => update.mutate({ webInterfacing: next })}
    />
  );
}
```

Render `<WebInterfacingSettings />` in the settings page body, adjacent to where
`<ProvidersSection />` is rendered (line ~322). Because no `web` offering exists
yet, `aggregateServiceKinds(usable)` never includes `'web'`, so this returns
`null` — the section is invisible, exactly as intended.

- [ ] **Step 10: Typecheck + run the settings/components suites**

Run: `pnpm typecheck`
Expected: PASS (13/13).

Run: `pnpm --filter @chatsundere/user-client test -- src/components src/lib src/routes/app/settings`
Expected: PASS (no regressions in the settings route tests).

- [ ] **Step 11: Commit**

```bash
git add apps/user-client/src/lib/web-backend-options.ts \
        apps/user-client/src/lib/web-backend-options.test.ts \
        apps/user-client/src/components/WebInterfacingSection.tsx \
        apps/user-client/src/components/WebInterfacingSection.test.tsx \
        apps/user-client/src/routes/app/settings.tsx
git commit -m "Add web-interfacing settings section (hidden until web unlocked)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 10: Full verification, documentation, hand-off

No new feature code. This task proves the whole thing is correct and dormant,
records the security follow-up, and updates STATUS. **Do not merge or push.**

- [ ] **Step 1: Full llm-unified suite**

Run: `cd packages/llm-unified && bun test`
Expected: PASS, 0 failures (the prior count was 251; this adds the
web-adapter-registry tests).

- [ ] **Step 2: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS, 13/13.

- [ ] **Step 3: Full build**

Run: `pnpm run build`
Expected: PASS, 9/9.

- [ ] **Step 4: Full user-client Vitest suite**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: PASS for everything new + everything previously green. The **only**
acceptable failures are the **8 pre-existing** `cockpit-draft` / `chat-page` /
`chat-route` localStorage-jsdom failures. If you see a 9th failure, you caused a
regression — fix it. To confirm the 8 are pre-existing, `git stash` your work,
run the suite on `master`, compare the failing set, then `git stash pop`.

- [ ] **Step 5: Record the planned outbound surface in the security journal**

Append to `obsidian/insights/security-deferrals.md` (British English):

```markdown
## Web-interfacing integration — planned outbound surface (2026-06-02)

The web-interfacing spine is dormant (no adapter), so there is no network call
yet. When the nano-gpt web adapter lands, the integration will send the user's
query/URL **plus the NSFW flag and location** to an upstream — privacy-sensitive
context leaving the device. Discipline for the adapter: retrieve the provider key
only at the outbound point via the credential bus (never persist or log it); never
log the query, URL, or location. Not a Larissa item for the spine (client-only,
no auth/sync/proxy/crypto path).
```

- [ ] **Step 6: Update STATUS-CLIENT-ONLY**

Edit `obsidian/STATUS-CLIENT-ONLY.md` per the project STATUS protocol: add a new
top entry summarising the spine (what landed, that it is dormant + non-regressive,
verification numbers), move it into the "Done" framing, set the **Next** block to
"the nano-gpt web adapter + curating the `web` offerings (brave/exa/linkup)", and
update the `Last updated:` line to 2026-06-02. Reference the spec + this plan.

- [ ] **Step 7: Commit the docs (doc-only → `[skip ci]`)**

```bash
git add obsidian/insights/security-deferrals.md obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Record web-interfacing spine status + planned outbound surface [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

- [ ] **Step 8: Stop. Hand back to Chris.**

Do **not** squash, merge, or push. Leave the branch `feat/web-interfacing-spine`
intact. In your final message, report: the verification numbers (llm-unified Bun,
typecheck, build, user-client Vitest pass/fail with the 8-failure baseline noted),
the list of commits on the branch, and confirm the spine is dormant (the model is
offered only `calculate_js` until a `web` offering + adapter exist). Chris will
device-test and integrate.

---

## Self-review (completed by the plan author)

- **Spec coverage:** §3.1 Integration → Task 3; §3.2 IntegrationContext/OfferingRef
  → Tasks 3 + 7; §3.3 registry seam → Task 5; §3.4 WebInterfacingProvider +
  web-adapter-registry + offering meta + the integration → Tasks 1, 2, 4; §4
  settings/persistence/visibility/UI → Tasks 6, 9; §5 wiring/gating/zero-regression
  → Task 8; §6 tests → woven through every task + Task 10; §7 security → Task 10
  Step 5; §8 deferrals (adapter tomorrow, location source, styling) → documented;
  §9 manual verification → Task 10 Step 8 hand-off + Chris on device.
- **Placeholder scan:** none — every code step carries complete code; the only
  "TBD"-like items are the explicitly-deferred adapter/location/styling, which are
  out of scope by design.
- **Type consistency:** `OfferingRef`, `WebOfferingMeta`, `IntegrationContext`
  fields (`webSearch`/`webFetch`, not `…OfferingId`), `resolveActiveTools` /
  `toolDefs(tools)` / `dispatch(tools, …)` signatures, and the `web`-keyed picker
  value format (`providerId::upstreamSlug`) are used consistently across Tasks
  1–9. `getOffering(providerTemplateId, upstreamSlug)` matches `registry.ts:77`.
