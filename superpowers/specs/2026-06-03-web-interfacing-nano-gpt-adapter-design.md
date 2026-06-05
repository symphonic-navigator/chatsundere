# Web Interfacing — nano-gpt Adapter & Go-Live (Design)

> **Date:** 2026-06-03 · **Author:** Liz (with Chris) · **Status:** awaiting Chris's review
> **Scope:** one feature unit — make the dormant web-interfacing spine go live via a
> nano-gpt search + fetch adapter, curated offerings, a cockpit depth control, and the
> systematic `requires-proxy` wiring.

## 1. Context

The web-interfacing **spine** landed 2026-06-02 (PR #1, `7fd4692`): a first-class
`Integration` abstraction with `web_search` + `web_fetch` tools, an empty
`web-adapter-registry`, `WebOfferingMeta` (`canSearch`/`canFetch`/`qualityClass`),
two settings pickers (search backend / fetch backend), `WebContext`
(`nsfwAllowed` + `location`), and `OfferingRef` keys. It is **dormant**: with zero
`web` offerings curated and no adapter registered, the model is only ever offered
`calculate_js`, exactly as before.

This spec turns it on. Nothing here touches `auth-/sync-/proxy-service` or
`packages/crypto` — **not a Larissa gate** (§9), but it opens a new outbound network
surface, logged in `insights/security-deferrals.md` (see §10).

## 2. Goals

- A nano-gpt **search adapter** (`/api/web`, Approach C) and **fetch adapter**
  (`/scrape-urls`), registered in `web-adapter-registry`.
- **Three** curated search offerings — **Linkup** (default), **Exa**, **Brave** —
  plus **one** fetch offering (**nano-gpt scrape**). Kagi deferred (§9).
- A **cockpit depth control** for search, per-offering curated tiers, user-set,
  defaulting to the cheapest tier — sitting alongside the reasoning control.
- **Systematic `requires-proxy` wiring**: the web path reuses the existing
  `buildRequest` proxy primitive; the proxy requirement is modelled as data on the
  web offering, decoupled from nano-gpt's chat `corsHint`.
- **Auto-default ON**: once the web modality is unlocked (proxy configured + key +
  offerings present), search defaults to Linkup and fetch to nano-gpt scrape, with no
  user action required. The user may switch backend or turn web search off.
- A **quiet zero-knowledge transparency line** in the settings section.

## 3. Non-goals / Deferred

- Kagi (empirically not worth it now — §9), Tavily, Perplexity, Valyu, OpenAI-native.
- ollama-cloud as a second fetch backend (architecture leaves room; not wired now).
- `WebLocation` *source* — `WebContext.location` stays threaded but flows `null`.
- BYOK (a future cheaper-Kagi path; not now).
- Routing the consented load through `proxy-service` (Phase 2).
- Deep-research / agentic multi-step search (a separate feature, different layer).

## 4. Empirical findings (measured 2026-06-03, not docs)

All search providers share one endpoint: `POST https://nano-gpt.com/api/web`.

**Search** `/api/web`, body `{ query, provider, depth?, outputType:"searchResults", … }`
→ `{ "data": [ { "type":"text", "title", "url", "content" }, … ],
   "metadata": { "query","provider","depth","cost", … } }`.

**Fetch** `/scrape-urls`, body `{ "urls": [ … ] }`
→ `{ "results": [ { "url","success","title","content","markdown" }, … ] }`.
Use the **`markdown`** field (richer); fall back to `content`.

**CORS — the load-bearing finding:**

| Endpoint | `access-control-allow-origin` |
|---|---|
| `/api/v1/chat/completions` (chat) | `*` → CORS-direct |
| `/api/web` (search) | **none** → browser blocks |
| `/scrape-urls` (fetch) | **none** → browser blocks |

→ The web endpoints **must** route through the user's CORS proxy (the `cors-proxy`
rail wafer/xai/ollama already use). nano-gpt **chat stays direct**; only the web
endpoints inherit the proxy.

**Measured cost / behaviour (real search):**

| Provider | Tier → param | Cost | Results | Character |
|---|---|---|---|---|
| Brave | `standard` (flat) | $0.005 | 10 | Privacy |
| Exa | `auto` / `neural` | $0.005 / $0.010 | 5 | AI / semantic |
| Linkup | `standard` / `deep` | $0.006 / **$0.060** | 20 / 19 | Recommended default |
| ~~Kagi~~ | `search` (web/news = **0 results**) | $0.025 | 19 | deferred — priciest, no niche |

`neural` was measurably the most on-topic for a conceptual query (earned its slot);
`exa-deep`/`deep-reasoning` did not justify their cost/latency. Linkup `deep` is **10×**
standard — a power-user tier, watch the cost.

## 5. Architecture

### 5.1 The proxy primitive (systematic, not ad hoc)

`buildRequest` (`packages/llm-unified/src/transport.ts:27`) is the **single** place
that applies the CORS proxy: when routing is `cors-proxy` it rewrites the URL to the
forwarder and sets `x-cors-proxy-api-key` + `x-cors-proxy-target` (lines 42–44).

- **Generalise the signature.** `buildRequest` reads only `provider.baseUrl` and
  `provider.routing`. Extract `RouteTarget = { baseUrl: string; routing: Routing }`
  and have `buildRequest` take a `RouteTarget` (LLM `ProviderConfig` satisfies it
  structurally). One primitive, two callers (LLM transport + web adapter).
- **Model the proxy requirement as data.** The web adapter carries its own
  `corsHint: 'requires-proxy'` and a `RouteTarget` with
  `baseUrl: 'https://nano-gpt.com/api'`, **decoupled** from nano-gpt's chat
  `corsHint: 'inofficial'`. The proxy requirement lives at the *capability/endpoint*
  level, not the provider level.

### 5.2 The web adapter

A new module (e.g. `packages/llm-unified/src/web-adapters/nano-gpt-web.ts`) exporting a
factory registered via `registerWebAdapter(adapterId, factory)`. It implements
`WebInterfacingProvider` (`web-interfacing.ts`):

- `search(query, ctx, opts)` → POST `/web` via `buildRequest`
  (`outputType:"searchResults"`, `provider`, tier params from §5.4); maps
  `data[]` → `WebSearchHit[]` (`{ title, url, snippet/content }`), returns
  `WebSearchResult`.
- `fetch(url, ctx)` → POST `/scrape-urls` (`{ urls:[url] }`); maps `results[0]` →
  `WebFetchResult` (`{ url, title, content: markdown ?? content }`).

The adapter needs the **proxy config** and the **nano-gpt key**; both arrive via the
`IntegrationContext` (§5.3). NSFW and location are present on `WebContext` but the
nano-gpt `/api/web` body takes **neither** → the adapter ignores them (documented for
future brave-direct).

### 5.3 Threading proxy config into the integration context

Today `IntegrationContext` carries `getKey`, `nsfwAllowed`, `location`, `webSearch`,
`webFetch`. Add the proxy config, sourced **identically** to the LLM path
(`ProviderSheet` decrypts the sealed `corsProxy.sharedKey` against the MasterKey):

```
IntegrationContext += { corsProxyUrl: string | null; corsProxyKey: string | null }
```

`buildIntegrationContext(persona, webSettings, mk, getKey, corsProxy)` resolves the
MK-gated shared key at **call time only** (never persisted/logged). `stream-manager`
already builds the context per send — it threads the decrypted proxy config in.

### 5.4 Curated offerings & depth tiers

Each search offering is a nano-gpt `Offering` with `serviceKind:'web'`, an
`adapter:{kind:'catalogue', adapterId:'nano-gpt-web'}`, `corsHint:'requires-proxy'`,
and a `web: WebOfferingMeta` carrying `canSearch:true`, `canFetch:false`,
`traits` (§5.5), and a **`searchTiers`** list:

```
searchTier = { id, label, tooltip?, costHint?, params: { depth?, numResults?, … } }
```

| Offering | upstreamSlug | tiers (default first) |
|---|---|---|
| Linkup | `web-linkup` | `Standard`→`{depth:'standard'}` · `Deep`→`{depth:'deep'}` (costHint: ~10×) |
| Exa | `web-exa` | `Quick`→`{depth:'auto', numResults:8}` · `Neural`→`{depth:'neural', numResults:8}` (tooltip "semantic search") |
| Brave | `web-brave` | `Standard`→`{depth:'standard'}` (single tier) |

All tier labels above are **user-facing copy → British English** per CLAUDE.md §3.7/§7
(`Quick` / `Neural` / `Standard` / `Deep`). We discussed them in German; they render in
English.

The **fetch** offering: `upstreamSlug:'scrape'`, `canFetch:true`, `canSearch:false`,
no tiers.

The depth control mirrors `ReasoningControl`: an offering with a single tier renders
**no** cockpit control (like reasoning `none`); ≥2 tiers render a chip group in the
cockpit menu alongside reasoning. State lives in `current-chat.store` next to
`reasoning`; a resolver (analogous to `reasoning-resolver.ts`) maps the selected tier
to the search call's params. **User-set, never LLM-chosen** — cost predictability.

### 5.5 Traits / badges

**Replace** `WebOfferingMeta.qualityClass` with `traits: WebTrait[]` — `ai-friendly`
folds into an `ai` trait (it semantically *is* a trait; Brave, by contrast, delivers
human-oriented results, not ai-friendly ones). The `WebQualityClass` type and the
`qualityClass` field are **removed**; the one existing usage
(`web-backend-options.ts`) migrates to `traits`.

```
WebTrait = 'recommended' | 'ai' | 'neural' | 'privacy'   // extensible
```

| Offering | traits (shown as badges in the backend picker) |
|---|---|
| Linkup | `recommended`, `ai` |
| Exa | `ai`, `neural` |
| Brave | `privacy` |

Badges render in the **settings backend picker** (where the backend is chosen), not in
the cockpit. Mobile-first: compact pills.

### 5.6 Auto-default & off-switch

The settings `webInterfacing.search` / `.fetch` gain a tri-state:

- **unset** (initial) → resolves to the **recommended default** (Linkup for search,
  nano-gpt scrape for fetch) when the web modality is available → web search is **on**
  with no user action.
- an explicit **`OfferingRef`** → the user's chosen backend.
- explicit **off** → the user turned it off (disabled-over-hidden: an "Off" option in
  the picker).

This replaces the current seed semantics (`null` = off). Resolution: a
`resolveWebBackend(setting, available)` helper returns the effective `OfferingRef | null`
(null = off). The whole modality stays gated on the proxy being configured + offerings
present; until then the section shows the existing "Set up a CORS proxy →" CTA.

### 5.7 Tool descriptions (British English)

- **web_search:** "Search the web for current, up-to-date information. Use it when the
  user asks you to look something up, or when answering accurately needs facts newer or
  more specific than your training."
- **web_fetch:** "Fetch and read the contents of a specific web page by its URL — use
  it when the user refers to a page, link, or article you should read."

## 6. Data model changes

- `WebOfferingMeta`: `qualityClass` (and the `WebQualityClass` type) **removed**,
  replaced by `traits: WebTrait[]`; search offerings += `searchTiers`.
- `IntegrationContext` += `corsProxyUrl` / `corsProxyKey`.
- `RouteTarget` extracted in `transport.ts`; `buildRequest` retargeted (no behaviour
  change for existing callers).
- `SettingsRow.webInterfacing` search/fetch fields become tri-state (unset / ref /
  off). **Dexie migration** to carry the new representation (likely v12); existing
  rows backfill to **unset** (→ default-on once proxy present).

## 7. Security (zero-knowledge honesty)

Web search/fetch inherently sends the (conversation-derived) query / URL to the chosen
provider — it **leaves the device** (via the user's own proxy → nano-gpt → provider).
This is unavoidable for web search, but for a Proton-bar product we surface it
honestly: a **quiet, permanent info line** in the `WebInterfacingSection`, e.g.
*"Search queries and fetched pages leave your device and are sent to the chosen
provider via your proxy."* No blocking modal.

The nano-gpt key is retrieved MK-gated **at call time only**, never persisted or
logged. Same for the decrypted proxy shared key. Logged in `security-deferrals.md` as
the realised outbound surface the spine anticipated.

Model-emitted markdown in fetched/searched content already passes through the
consent-gated `ImageMarker` renderer (no auto-fetch) — no new image-leak surface.

## 8. Testing

Per §10 of CLAUDE.md (adapters validated against real protocol behaviour, never in CI):

- **Unit (Bun, llm-unified):** search-response → `WebSearchHit[]` mapping;
  scrape-response → `WebFetchResult` mapping (markdown preferred); `buildRequest` via
  `RouteTarget` produces a `cors-proxy` request for the web target while leaving LLM
  callers unchanged; tier params merged correctly.
- **Unit (vitest, user-client):** `web-integration` contributes `web_search` only when
  a search offering is selected **and** a proxy is configured **and** the adapter
  resolves; `web_fetch` likewise; auto-default resolution (unset→Linkup);
  off-switch (explicit off → no tool); proxy-config threading.
- **Live probe harness** (analog to the conversation-suite, keys never in CI): a small
  `run-web-suite.ts` that hits `/api/web` (linkup/exa/brave) + `/scrape-urls` through
  the proxy and asserts shape + non-empty results, flipping offerings to `verified`.
- Full vitest must pass (not just touched dirs) — verno bump expected after the
  migration.

## 9. Manual verification (device steps for Chris)

1. With the proxy **down**: My Settings shows the web section gated with "Set up a CORS
   proxy →"; no web tools offered in chat.
2. Configure the VPS proxy + nano-gpt key: the web section appears, **Linkup**
   pre-selected as search, **nano-gpt scrape** as fetch — both on, untouched.
3. Ask something current ("latest stable Bun version") → the model calls `web_search`,
   a pill shows the search, the answer cites fresh results.
4. Switch search backend to **Exa**; the cockpit shows **Quick / Neural**; pick
   **Neural**; re-ask a conceptual question → semantically tighter results.
5. Switch to **Brave** → cockpit shows **no** depth control (single tier).
6. Refer to a URL in prose ("summarise https://endoflife.date/bun") → `web_fetch`
   scrapes it; the answer reflects the page.
7. Turn web search **off** in settings → no `web_search` tool offered; `calculate_js`
   still works.
8. Confirm the zero-knowledge info line is present and calm.

## 10. Review decisions (resolved 2026-06-03, with Chris)

- **Off-switch UX:** include an explicit "Off" option in the picker — **confirmed**
  (we already have options, so an off-state fits cleanly).
- **Exa `numResults`:** **8** — confirmed (the gem is sometimes a little further down).
- **`qualityClass` → `traits`:** fold `ai-friendly` into the `ai` trait; remove
  `qualityClass` / `WebQualityClass` — **confirmed** (semantically cleaner; Brave is
  human-oriented, not ai-friendly).
