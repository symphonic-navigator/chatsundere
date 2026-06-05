# Ollama-Cloud Web Interfacing + First-Come Default — Design

> Spec. 2026-06-03. Extends the web-interfacing spine (search/fetch via nano-gpt)
> with a second backend (Ollama Cloud) and reworks the default-selection so the
> first-configured provider wins, with graceful fallback.

## 1. Goal

Two independent pieces shipped together:

- **A — Ollama Cloud as a web backend.** Port chatsune's working Ollama web
  search + fetch (`ollama.com/api/web_search`, `/api/web_fetch`) into our
  client-side web-interfacing spine, routed through the user's CORS proxy.
- **B — First-come default with fallback.** When the user has not made an
  explicit choice, the effective search/fetch backend defaults to the
  **first-configured** usable provider (per role). When an explicitly-chosen
  backend becomes unusable (its key/provider was deleted), fall back to the
  next-best instead of going dark.

Both are small. B is the design question Chris raised; A is a near-mechanical
port of a proven template.

## 2. Background — what exists today

- The spine: `WebInterfacingProvider` (`search?`/`fetch?`), the
  `web-adapter-registry`, `serviceKind: 'web'` offerings carrying `WebOfferingMeta`
  (`canSearch`/`canFetch`/`requiresProxy`/`traits`/`searchTiers`), and the
  `web_search`/`web_fetch` tools in `apps/user-client/src/integrations/web/`.
- nano-gpt is the only web provider today: `web-linkup` (recommended), `web-exa`,
  `web-brave` (search), `web-scrape` (fetch). Its adapter
  (`packages/llm-unified/src/web-adapters/nano-gpt-web.ts`) routes through
  `buildRequest` with `routing: cors-proxy` in the browser, `direct` in the
  Bun live-suite.
- Selection is stored in `SettingsRow.webInterfacing = { search, fetch }` where
  each is `WebBackendSetting = OfferingRef | 'off' | null`. It is resolved
  **live, per message** by `resolveWebBackend(setting, options, role)`
  (`apps/user-client/src/lib/web-backends.ts`) against the currently usable
  options.
- "Usable" = enabled provider with a working route. A provider row exists only
  when the user configured it with a key (`useUpsertProvider`); deleting the key
  deletes the row (`useDeleteProvider` → `db.providers.delete`). **There is no
  keyless-but-enabled state**, so "usable" already implies "has key".
- `ProviderRow` carries `createdAt: number` and a time-ordered `uuidv7` `id`, so
  insertion order is already available — no new state is needed for "first come".

## 3. Part A — Ollama Cloud web backend

### 3.1 Endpoints & wire shapes (from chatsune, verified)

| | Search | Fetch |
|---|---|---|
| Method/path | `POST https://ollama.com/api/web_search` | `POST https://ollama.com/api/web_fetch` |
| Auth | `Authorization: Bearer <key>` | same |
| Request | `{ query, max_results }` (`max_results` 1–10, default 5) | `{ url }` |
| Response | `{ results: [{ title, url, content? , … }] }` *(snippet may arrive as `content`/`snippet`/`description`)* | `{ content, title? }` |

The **same `ollama-cloud` key** serves both LLM (`/api/chat`) and web — one
provider, one credential. ollama.com sends no CORS headers, so the browser must
route through the user's CORS proxy (`requiresProxy: true`), exactly like the
ollama-cloud LLM provider (`corsHint: 'requires-proxy'`).

### 3.2 Adapter — `packages/llm-unified/src/web-adapters/ollama-web.ts` (new)

Mirrors `nano-gpt-web.ts` structurally:

- `WEB_BASE_URL = 'https://ollama.com/api'`; `routeFor(ctx)` returns
  `{ baseUrl, routing: ctx.corsProxyUrl ? 'cors-proxy' : 'direct' }`.
- A shared `postWeb(ctx, key, path, body, fetchImpl, signal)` using `buildRequest`
  (`apiKey: key` → Bearer), throwing on `!res.ok`.
- `ollamaWebSearchAdapter(fetchImpl = fetch): WebInterfacingProvider` with
  `search(query, ctx, key, opts, signal)`:
  - Map the tier param to Ollama's shape: `max_results = clamp(opts.numResults ?? 5, 1, 10)`.
    (`WebSearchOpts` stays stable; the provider-specific translation lives in the
    adapter, like the ollama-native LLM adapter.)
  - Body `{ query, max_results }`. Parse `payload.results ?? []` into
    `WebSearchHit[]`: `title = r.title ?? ''`, `url = r.url ?? ''`,
    `snippet = (r.content ?? r.snippet ?? r.description ?? '').slice(0, SNIPPET_CAP)`
    (reuse the 600-char cap nano-gpt uses).
  - Return `{ query, hits }`.
- `ollamaWebFetchAdapter(fetchImpl = fetch): WebInterfacingProvider` with
  `fetch(url, ctx, key, signal)`: body `{ url }`, parse `{ content, title }`,
  return `{ url, content: payload.content ?? '' }`. Throw `Could not fetch ${url}.`
  when `content` is absent/empty. **No hard truncation** (consistent with our
  nano-gpt scrape; context management lives elsewhere).

### 3.3 Catalogue — `providers/ollama-cloud.ts` (modify)

Add two web offerings (two separate offerings, per the chosen design) using a
local `webOffering(slug, meta)` helper modelled on nano-gpt's `webSearchOffering`
(`providerId: 'ollama-cloud'`, `adapter.kind: 'catalogue'`,
`adapterId: ollama-cloud:<slug>`, `serviceKind: 'web'`, non-chat profile,
`context {0,0}`, `confidence: 'verified'`, `web: meta`):

- `web-ollama-search` — `canSearch: true, canFetch: false, requiresProxy: true,
  traits: ['ai']`, `searchTiers: OLLAMA_TIERS`.
- `web-ollama-fetch` — `canSearch: false, canFetch: true, requiresProxy: true,
  traits: []`.

```ts
const OLLAMA_TIERS: SearchTier[] = [
  { id: 'standard', label: 'Standard', params: { numResults: 5 } },
  { id: 'quick',    label: 'Quick', tooltip: 'fewer results, faster', params: { numResults: 3 } },
  { id: 'deep',     label: 'Deep', tooltip: 'more results, slower', params: { numResults: 10 } },
];
```

The execution path uses `tiers[0]` when the user has not picked a tier
(`web-integration.ts`: `tiers.find(t => t.id === ctx.webSearchTierId) ?? tiers[0]`).
To honour **standard (5) as the default**, the tiers are listed
**recommended-first** (`standard, quick, deep`) rather than ascending — so
`tiers[0]` is the 5-result standard. The cockpit depth picker surfaces these via
the existing `useActiveSearchTiers` path — no cockpit changes needed.

`registerOllamaCloud()` gains web-adapter registration, mirroring nano-gpt:

```ts
for (const o of webOfferings) {
  if (o.adapter.kind !== 'catalogue') continue;
  if (o.web?.canFetch) registerWebAdapter(o.adapter.adapterId, () => ollamaWebFetchAdapter());
  else registerWebAdapter(o.adapter.adapterId, () => ollamaWebSearchAdapter());
}
```

ollama-cloud now has **4 offerings** (2 LLM + 2 web).

## 4. Part B — First-come default with fallback

### 4.1 First-come ordering

`usableTemplateIds(providers, hasProxy)` (`lib/usable-providers.ts`) currently
maps providers in `toArray()` order. Make the ordering **explicit and stable**:
sort the enabled providers by `createdAt` ascending before mapping. The
first-configured provider then yields the first web option per role, so
`resolveWebBackend(null, …)` returns the first-configured backend — Chris's
"first come, first serve", per role, with no new state.

### 4.2 Ref fallback

`resolveWebBackend` (`lib/web-backends.ts`) today returns `null` when an explicit
ref is no longer usable. Change the tail to fall back to the first usable option:

```ts
const match = usable.find(
  (o) => o.providerId === setting.providerId && o.upstreamSlug === setting.upstreamSlug,
);
if (match) return refOf(match);
return usable[0] ? refOf(usable[0]) : null; // explicit pick gone → next-best
```

`'off'` still returns `null`; `null` still returns `usable[0]`. The stored
setting is **never mutated** on key add/remove — the live resolution reflects the
current world automatically, and an explicit pick reactivates itself when its key
returns. No key-event mechanism is built.

### 4.3 Friendly label fix

`web-backend-options.ts` derives a search backend's label from its slug:
`bare = slug.replace(/^web-/, '')`. For `web-ollama-search` this yields
`ollama-search` → "Ollama-search". Extend the strip to drop a trailing
`-search`/`-fetch`:

```ts
const bare = o.upstreamSlug.replace(/^web-/, '').replace(/-(search|fetch)$/, '');
```

`web-ollama-search` → "Ollama", `web-linkup` → "Linkup" (unchanged). Fetch labels
still come from `provider.displayName` ("Ollama Cloud"), unaffected.

## 5. Files

| File | Change |
|---|---|
| `packages/llm-unified/src/web-adapters/ollama-web.ts` | **new** — search + fetch adapters |
| `packages/llm-unified/src/web-adapters/ollama-web.test.ts` | **new** — unit tests (injected fetch) |
| `packages/llm-unified/src/providers/ollama-cloud.ts` | add 2 web offerings + tiers + registry registration |
| `packages/llm-unified/src/providers/builtins.test.ts` | ollama-cloud now 4 offerings (2 web); assert traits/tiers |
| `apps/user-client/src/lib/usable-providers.ts` | sort enabled providers by `createdAt` |
| `apps/user-client/src/lib/web-backends.ts` | ref fallback in `resolveWebBackend` |
| `apps/user-client/src/lib/web-backend-options.ts` | strip `-search`/`-fetch` suffix in label |
| `apps/user-client/src/lib/web-backends.test.ts` | fallback + first-come cases |
| `apps/user-client/src/lib/web-backend-options.test.ts` | label + ordering cases |
| `obsidian/providers/ollama-cloud.md` | record the web capability |
| `obsidian/STATUS-CLIENT-ONLY.md` | session-end update |

## 6. Verification

- **Bun** (`packages/llm-unified`): adapter unit tests (search/fetch shapes,
  `max_results` clamp/map, error paths); builtins test for the 2 new offerings.
- **Vitest** (`apps/user-client`): `resolveWebBackend` (off / null→first / ref
  match / ref-gone→next-best) and `usableTemplateIds` createdAt ordering, label
  suffix strip.
- `pnpm typecheck` (src + test tsconfigs — the CI gate).
- **Live probe** against `ollama.com` (key `keys/.ollama-test-key`, never CI):
  one real `web_search` and one real `web_fetch`, full response matched serially.
- **Manual (device, Chris):**
  1. With only an ollama-cloud key configured → search + fetch default to Ollama.
  2. With only a nano-gpt key → Linkup + Scrape (unchanged).
  3. Configure ollama first, then nano-gpt → defaults stay Ollama (first-come).
  4. Delete the in-use provider's key → the next-best backend takes over, no dark
     state.
  5. In a chat, run a real web search and a real fetch through Ollama (glm-5.1 /
     deepseek-v4-pro) and confirm the model answers.

## 7. Out of scope / non-goals

- No CORS-proxy / `apps/proxy-service` changes — we reuse the existing
  client-side cors-proxy rail. No Larissa gate (no `auth-/sync-/proxy-service`,
  no `crypto`).
- No cockpit UI changes — tiers flow through the existing path.
- No content truncation, no location/NSFW plumbing beyond what the spine already
  passes.
