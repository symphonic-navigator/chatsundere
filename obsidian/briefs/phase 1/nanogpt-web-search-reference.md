# NanoGPT Web Search — Complete Reference

> Consolidated from the scattered NanoGPT docs (model-suffixes, chat-completion,
> text-generation, web-search endpoint, brave). As of June 2026.
>
> Base URL: `https://nano-gpt.com/api/v1` (chat) / `https://nano-gpt.com/api` (web search endpoint)

## TL;DR

There are **three ways** to do web search on NanoGPT:

| Approach | Endpoint | When to use |
| --- | --- | --- |
| **A. Model suffix** | `POST /api/v1/chat/completions` + `:online/<provider>` | Quick, one-call "answer with web context" |
| **B. `webSearch` body object** (recommended) | `POST /api/v1/chat/completions` + `webSearch` object | Same, but with per-provider fine-tuning (results count, filters, etc.) |
| **C. Direct Web Search API** | `POST /api/web` | Raw/structured search results without an LLM call; explicit query + output control |

**Available providers:** `linkup` · `tavily` · `brave` · `exa` · `kagi` · `perplexity` · `valyu` (+ OpenAI native for GPT-5+/o-series).

If `webSearch.enabled` (or legacy `linkup.enabled`) is `true`, **the body config wins** over any model suffix.

---

## Provider Quick Reference

| Provider | Suffix(es) | Body `depth` values | Standard $ | Deep $ | Notes |
| --- | --- | --- | --- | --- | --- |
| **Linkup** (default) | `:online`, `:online/linkup`, `:online/linkup-deep` | `standard`, `deep` | $0.006 | $0.06 | Default backend for bare `:online`. `standard` runs as Linkup `fast` under the hood. Only provider with full `/api/web` output-type support. |
| **Exa** | `:online/exa-fast`, `:online/exa-auto`, `:online/exa-neural`, `:online/exa-deep`, `:online/exa-instant`, `:online/exa-deep-reasoning` | `fast`, `auto`, `neural`, `deep`, `instant`, `deep-reasoning` (use `standard` → `auto`) | $0.005 base | + $0.001/page | Best for contents retrieval; rich filter options. |
| **Brave** | `:online/brave`, `:online/brave-deep` | `standard`, `deep` | $0.005 | $0.005 | Flat rate regardless of depth. |
| **Tavily** | `:online/tavily`, `:online/tavily-deep` | `standard`, `deep` | $0.008 | $0.016 | Good value, free tier available. |
| **Kagi** | `:online/kagi`, `:online/kagi-web`, `:online/kagi-news`, `:online/kagi-search` | `standard`, `deep` (`search` source only) | Web/News $0.002 · Search $0.025 | N/A | Web/News cheapest for enrichment. `kagiSource`: `web`/`news`/`search`. |
| **Perplexity** | `:online/perplexity`, `:online/perplexity-deep` | `standard`, `deep` | $0.005 | N/A | Flat rate. |
| **Valyu** | `:online/valyu`, `:online/valyu-deep`, `:online/valyu-web`, `:online/valyu-web-deep` | `standard`, `deep` | ~$0.0015/result | Variable | Dynamic pricing. `searchType`: `all`/`web`. |
| **OpenAI native** | (automatic for GPT-5+/o1/o3/o4) | — | $0.01 + tokens | N/A | Used automatically by `:online` on those models unless a provider is forced. |

**SimpleQA benchmark (factuality):** Linkup Deep 90.10% · Exa 90.04% · Perplexity Sonar Pro 86% · Linkup Standard 85% · Perplexity Sonar 77% · Tavily 73%.

---

## Approach A — Model Suffixes

Append to the `model` value. The suffix is stripped before routing to the base model; it only controls search behavior.

```json
{ "model": "openai/gpt-5.2:online", "messages": [{ "role": "user", "content": "..." }] }
{ "model": "openai/gpt-5.2:online/exa-neural", "messages": [...] }
{ "model": "anthropic/claude-opus-4.6:online/linkup-deep", "messages": [...] }
{ "model": "openai/gpt-5.2:online/brave", "messages": [...] }
```

`:online` without an explicit provider → Linkup (or OpenAI native on GPT-5+/o-series).

**Composes with** memory + reasoning-exclude suffixes:
```
openai/gpt-5.2:online/exa-instant:memory-30
anthropic/claude-opus-4.6:memory-30:online/linkup-deep:reasoning-exclude
```

Full suffix list: <https://docs.nano-gpt.com/api-reference/miscellaneous/model-suffixes#web-search-suffixes>

---

## Approach B — `webSearch` Body Object (recommended)

Works with or without a model suffix. Legacy `linkup` object accepted as an alias.

### Core fields

| Field | Type | Notes |
| --- | --- | --- |
| `enabled` | boolean | **Required** to activate. |
| `provider` | string | `linkup` \| `tavily` \| `brave` \| `exa` \| `kagi` \| `perplexity` \| `valyu` |
| `depth` | string | See per-provider values in the Quick Reference table above. |
| `search_context_size` / `searchContextSize` | string | OpenAI native: `low` \| `medium` \| `high` (default `medium`) |
| `user_location` / `userLocation` | object | OpenAI native: `{ type: "approximate", country, city, region }` |
| `searchType` | string | Valyu only: `all` \| `web` |
| `kagiSource` / `kagi_source` | string | Kagi only: `web` \| `news` \| `search` |

### Minimal example

```json
{
  "model": "openai/gpt-5.2",
  "messages": [{ "role": "user", "content": "Analyze recent AI breakthroughs" }],
  "webSearch": {
    "enabled": true,
    "provider": "exa",
    "depth": "neural",
    "numResults": 10
  }
}
```

### Provider-specific options (set inside `webSearch`)

#### Exa
```json
{
  "numResults": 1-100,
  "category": "company" | "research paper" | "news" | "pdf" | "github" | "tweet" | "personal site" | "people" | "financial report",
  "userLocation": "US",
  "additionalQueries": ["query2"],
  "startCrawlDate": "ISO 8601", "endCrawlDate": "ISO 8601",
  "startPublishedDate": "ISO 8601", "endPublishedDate": "ISO 8601",
  "includeText": ["pattern"], "excludeText": ["pattern"],
  "livecrawl": "never" | "fallback" | "always" | "preferred",
  "livecrawlTimeout": number,
  "subpages": number,
  "subpageTarget": "string" | ["strings"]
}
```

#### Brave
No documented provider-specific options beyond core `depth`. Flat $0.005 standard/deep.
Provider notes: <https://docs.nano-gpt.com/api-reference/miscellaneous/brave>

#### Tavily
```json
{
  "maxResults": 0-20,
  "includeAnswer": boolean | "basic" | "advanced",
  "includeRawContent": boolean | "markdown" | "text",
  "includeImages": boolean,
  "includeImageDescriptions": boolean,
  "includeFavicon": boolean,
  "topic": "general" | "news" | "finance",
  "timeRange": "day" | "week" | "month" | "year",
  "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD",
  "chunksPerSource": 1-3,
  "country": "string"
}
```

#### Perplexity
```json
{
  "maxResults": 1-20,
  "maxTokensPerPage": number,
  "maxTokens": 1-1000000,
  "country": "string",
  "searchDomainFilter": ["domain1.com", ...],   // max 20
  "searchLanguageFilter": ["en", "de"]           // max 10, ISO 639-1
}
```

#### Valyu
```json
{
  "searchType": "all" | "web",
  "fastMode": boolean,
  "maxNumResults": 1-50,
  "maxPrice": number,
  "relevanceThreshold": 0-1,
  "responseLength": "short" | "medium" | "large" | "max" | number,
  "countryCode": "US",                            // 2-letter ISO
  "includedSources": ["source1.com"],
  "excludedSources": ["source2.com"],
  "urlOnly": boolean,
  "category": "string"
}
```

#### OpenAI native (GPT-5+/o-series)
```json
{
  "search_context_size": "low" | "medium" | "high",
  "user_location": { "type": "approximate", "country": "US", "city": "...", "region": "..." }
}
```

Full body reference: <https://docs.nano-gpt.com/api-reference/endpoint/chat-completion#web-search>

---

## Approach C — Direct Web Search API (`POST /api/web`)

For raw/structured results without an LLM call. Auth via `Authorization: Bearer` or `x-api-key`.

### Request body

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | — | **Required.** |
| `provider` | string | `linkup` | `openai-native` not allowed here. |
| `depth` | string | `standard` | Linkup: `standard` (= `fast`) or `deep`. |
| `outputType` | string | `searchResults` | `searchResults` \| `sourcedAnswer` \| `structured` |
| `structuredOutputSchema` | string | — | Required when `outputType: "structured"`. JSON schema as a string. |
| `includeImages` | boolean | `false` | |
| `fromDate` / `toDate` | string | — | `YYYY-MM-DD` |
| `includeDomains` / `excludeDomains` | string[] | — | |

> **Important:** `sourcedAnswer` and `structured` output types are **Linkup-only**.
> Non-Linkup providers support only `outputType: "searchResults"`.

### Response shape

```json
{
  "data": "... provider-formatted payload ...",
  "metadata": {
    "query": "string",
    "provider": "linkup",
    "depth": "standard",
    "outputType": "sourcedAnswer",
    "timestamp": "ISO-8601",
    "cost": 0.006
  }
}
```
- `searchResults` → `data` is an array of normalized results.
- `sourcedAnswer` / `structured` → `data` is the provider response object.

### Example — structured output (Linkup)

```bash
curl -X POST https://nano-gpt.com/api/web \
  -H "Authorization: Bearer $NANOGPT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Top 5 AI coding tools in 2026 with pricing",
    "provider": "linkup",
    "depth": "standard",
    "outputType": "structured",
    "structuredOutputSchema": "{\"type\":\"object\",\"properties\":{\"tools\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"},\"price\":{\"type\":\"string\"}},\"required\":[\"name\"]}}},\"required\":[\"tools\"]}"
  }'
```

### Error codes

| Status | Meaning |
| --- | --- |
| `400` | Invalid parameters |
| `401` | Invalid session or auth |
| `402` | Insufficient balance or usage cap |
| `429` | Rate limited |
| `503` | Provider key missing |
| `504` | Search failed or timed out |

Full endpoint reference: <https://docs.nano-gpt.com/api-reference/endpoint/web-search>

---

## BYOK (Bring Your Own Key)

- Configure keys once at <https://nano-gpt.com/byok>
- Opt in per request: header `x-use-byok: true` or body `byok.enabled: true`
- Force provider: header `x-byok-provider` or body `byok.provider`
- **5% platform fee** on BYOK usage; your provider bills you for actual usage directly.
- Web search BYOK availability is **provider-dependent** — check the BYOK support matrix.

Reference: <https://docs.nano-gpt.com/api-reference/miscellaneous/byok>

---

## Notes / Gotchas

- Web search increases input token count → affects total model cost on top of the search fee.
- Query formation (non-OpenAI providers): derived from your latest user message, may include the previous user message if the latest is short. Need full control? Use `/api/web`.
- For OpenAI native models, bare `:online` uses OpenAI's built-in search. Force a different provider with an explicit suffix or `webSearch.provider`.
- `scraping: true` (separate from web search): scans messages for public http(s) URLs, dedupes, caps at 5, $0.0015 per scraped URL. Standalone `/scrape-urls` is $0.001 per URL.

---

## Source pages

- Model Suffixes — <https://docs.nano-gpt.com/api-reference/miscellaneous/model-suffixes>
- Chat Completion (web search section) — <https://docs.nano-gpt.com/api-reference/endpoint/chat-completion#web-search>
- Text Generation guide — <https://docs.nano-gpt.com/api-reference/text-generation>
- Direct Web Search API — <https://docs.nano-gpt.com/api-reference/endpoint/web-search>
- Brave provider notes — <https://docs.nano-gpt.com/api-reference/miscellaneous/brave>
- BYOK — <https://docs.nano-gpt.com/api-reference/miscellaneous/byok>
- Docs index — <https://docs.nano-gpt.com/llms.txt>
