# Provider Curation Record — OpenRouter

> Provider record. Per-model offerings cross-link back here for the shared
> OpenRouter mechanics.

- **Provider id:** `openrouter` · **displayName:** OpenRouter
- **Base URL:** `https://openrouter.ai/api/v1`
- **Shape:** `openai-chat-completions` (uniform OpenAI-compatible surface)
- **Key file:** `keys/.or-test-key` (gitignored, never in CI)
- **Documentation:** <https://openrouter.ai/docs> — but empirical truth over docs
  (CLAUDE.md §13); every claim below was probed live 2026-05-31.

## What OpenRouter is — and what it is not

OpenRouter is a **US-based router / aggregator**: it does not host weights, it
forwards each request to one of several upstream providers behind a single
unified OpenAI-compatible API. This shapes every trust judgement:

- **NOT ZDR by default.** Data transits OpenRouter's US infrastructure and then
  the chosen upstream. There is no project-wide zero-data-retention guarantee.
- **NOT a TEE.** No trusted-execution attestation.
- **Trust is per-route.** Each underlying provider carries its own retention and
  jurisdiction posture; OpenRouter exposes per-request provider routing, but we
  do not pin routes in the curated offerings, so the honest baseline is
  `trust: { tee: false, zdr: false, jurisdiction: 'US' }` on every offering. No
  🔒 Privacy badge unless a specific pinned route is later shown to be ZDR/TEE.
- **Jurisdiction:** US.
- **Censorship:** OpenRouter itself adds no content filter — it routes verbatim.
  The per-deployment freedom judgement (`freedomOrientedDeployment`) is **Chris's
  call** and is left `null` (not assessed) for now, so the 🕊️ badge resolves to
  *unknown* rather than asserting either way. 🕊️ **Freedom: pending Chris.**

## Zero-Data-Retention (ZDR) — per-request (added 2026-06-28)

OpenRouter supports **per-request ZDR enforcement**
(<https://openrouter.ai/docs/guides/features/zdr>) via a **body** parameter
nested under `provider` — *not* a top-level field and *not* a header:

```json
{ "model": "x-ai/grok-4.3", "messages": [...], "provider": { "zdr": true } }
```

With `provider:{zdr:true}` OpenRouter routes the request **only** to endpoints
with a Zero-Data-Retention policy. Because it is a **body** field it survives the
conversation-suite path cleanly (unlike a per-request header — and note the old
"suite binding drops `wire.headers`" flag below is **stale**: `binding.ts` now
forwards `extraHeaders: wire.headers`).

**Probed live 2026-06-28 (Grok):** `x-ai/grok-4.3` and `x-ai/grok-4.20` both
route ZDR cleanly — HTTP 200, `provider: "xAI"` (xAI now offers ZDR on
OpenRouter). These two offerings therefore carry `trust.zdr: true` and the 🔒
badge; the adapter (`openRouterAdapter`, `zdr` option) sends the flag on every
request, driven by the offering's `trust.zdr` so the claim is **enforced on the
wire, never merely asserted**.

**Fail-closed (proven, not assumed).** When no compliant endpoint exists,
OpenRouter returns **HTTP 404** ("No allowed providers are available for the
selected model") — it does **not** silently fall back to a retaining endpoint.
Forced live 2026-06-28 with `provider:{zdr:true, only:["azure"]}` on Grok (xAI is
not on Azure) → 404, `available_providers:["xai"]`. So if xAI's ZDR endpoint were
ever unavailable the request fails visibly (our adapter surfaces the non-2xx;
`assertNoHttpError` would catch it), never leaking to a non-ZDR route. This is the
honest posture for a privacy claim.

## Reasoning normalisation — the headline finding

OpenRouter exposes a **unified `reasoning` request parameter** and, crucially,
**normalises every upstream's thinking onto a single response channel**:

- **Request:** `reasoning: { enabled: true, effort? }` enables, `{ enabled: false }`
  disables. (`reasoning_effort` is also accepted on some routes, but the unified
  `reasoning` object is the portable surface, so the adapter uses it uniformly.)
- **Response:** thinking **always** arrives on `delta.reasoning`, never
  `delta.reasoning_content` — even for models whose *native* field is
  `reasoning_content` (GLM, Kimi). OpenRouter rewrites it. The adapter reads
  `reasoning` first and falls back to `reasoning_content` only defensively, in
  case a future route leaks the native field.
- **`{ enabled: false }` is a GENUINE off for every curated target** (0 reasoning
  tokens, empty `reasoning` channel — probed live 2026-05-31). This is the key
  divergence from Tensorix/wafer: **GLM-5.1 and Kimi-K2.6, which are `fixed-on`
  on those providers (their off only hides), toggle cleanly on OpenRouter**
  because OpenRouter's unified param is honoured per route. Every OpenRouter
  offering is therefore a **`toggle`** (`defaultOn: true`).

Per-target reasoning probe (single neutral prompt, reasoning on vs off):

| Slug | on: reasoning chars / tokens | off: reasoning chars / tokens | Verdict |
|---|---|---|---|
| `deepseek/deepseek-v3.2` | 555 / 201 | 0 / 0 | clean toggle |
| `deepseek/deepseek-v4-flash` | 163 / 41 | 0 / 0 | clean toggle |
| `deepseek/deepseek-v4-pro` | 272 / 81 | 0 / 0 | clean toggle |
| `z-ai/glm-5` | 642 / 304 | 0 / 0 | clean toggle |
| `z-ai/glm-5.1` | 450 / 153 | 0 / 0 | clean toggle (fixed-on elsewhere) |
| `moonshotai/kimi-k2.6` | 621 / 169 | 0 / 0 | clean toggle (fixed-on elsewhere) |
| `google/gemma-4-31b-it` | 544 / 153 | 0 / 0 | clean toggle |
| `qwen/qwen3.5-397b-a17b` | 784 / 214 | 0 / 0 | clean toggle |

Effort buckets are not shown to measurably modulate the trace, so reasoning is
modelled as a plain on/off `toggle`, not `steps` (the honest control, consistent
with wafer/Tensorix).

## Tool calls

Tool calls stream **fragmented**: the `id` + `function.name` arrive on one SSE
event, the `arguments` JSON on one or more **later** events, then a
`finish_reason: tool_calls` event. This is exactly the case the runtime
`src/streaming.ts` parser gets wrong, so the adapter's `parseChunk` buffers and
concatenates the `arguments` fragments and flushes a single `tool-call` chunk on
`finish_reason`. Tool calls fire reliably and run concurrently with reasoning
(`concurrentWithReasoning: true`).

## `usage` reporting

OpenAI-standard shape, delivered on the **final `choices`-bearing event**
(requested via `stream_options.include_usage`):

- `reasoning_tokens` nested under `completion_tokens_details` (not top-level).
- `cached_tokens` under `prompt_tokens_details` — populated on a cache hit
  (observed 192 cached prompt tokens on a repeated tool prompt).
- OpenRouter additionally reports `cost` / `cost_details` and an `is_byok` flag;
  these are ignored by the adapter (not part of `NormalisedUsage`).

## Mid-stream errors

OpenRouter can open with **HTTP 200** and then emit an SSE `error` object on an
upstream failure. The adapter surfaces this as a `{ type: 'error' }` stream chunk
(so `assertNoStreamError` would catch it) rather than dropping it silently.

## CORS verdict — `direct`

The OPTIONS preflight to `/api/v1/chat/completions` returns **HTTP 204** with
`Access-Control-Allow-Origin: *` and an `Access-Control-Allow-Headers` list that
includes `Authorization`, `HTTP-Referer`, `X-Title` (probed live 2026-05-31). So
**direct browser calls work** — `corsHint: 'direct'`, no proxy needed (unlike
wafer, which 405s the preflight).

## Optional attribution headers

OpenRouter supports `HTTP-Referer` (app/site URL) and `X-Title` (app name) for
its dashboard rankings. These are **cosmetic, never functional** — OpenRouter
works without them. The adapter can emit them via the
`WireRequest.headers` → `transport.extraHeaders` mechanism (the same wafer uses
for `Wafer-ZDR`) when an `attribution` option is supplied; the registered
adapters do **not** set them by default.

> **Flag for Liz — suite binding does not forward `wire.headers`.** The live
> conversation-suite binding (`curation/conversation-suite/binding.ts`) calls
> `buildRequest` **without** passing `wire.headers` as `extraHeaders`, so any
> adapter-supplied per-request header (wafer's `Wafer-ZDR`, OpenRouter's
> attribution) is **not** actually sent on the suite path — only the production
> runtime path forwards them. For OpenRouter this is harmless (attribution is
> cosmetic), but it means the wafer ZDR header is silently dropped in suite runs
> too. Out of scope to fix here (shared harness); flagged for Liz's judgement.

## Curated offerings (11)

All `confidence: 'verified'`, `source: 'curated'`, adapter
`openrouter:<slug>`, reasoning `toggle` (defaultOn),
`freedomOrientedDeployment: true` (Chris, 2026-05-31 — OpenRouter routes
verbatim, no censorship layer). `recommended` follows our project sweet-spots
where it differs from OpenRouter's reported `max`. Trust is
`{ tee: false, zdr: false, jurisdiction: 'US' }` **except** the two Grok
offerings, which are 🔒 **ZDR** (`zdr: true`; see the ZDR section above).

**Two exceptions to the uniform shape:** the two Grok offerings are 🔒 ZDR, and
**Claude Sonnet 5** (added 2026-06-30) uses a dedicated caching-aware adapter and
a `steps` reasoning control — see the Claude Sonnet 5 section below.

| Canonical | OpenRouter slug | vision | recommended / max | trust |
|---|---|---|---|---|
| `deepseek-v3.2` | `deepseek/deepseek-v3.2` | ❌ | 131 072 | — |
| `deepseek-v4-flash` | `deepseek/deepseek-v4-flash` | ❌ | 200 000 / 1 048 576 | — |
| `deepseek-v4-pro` | `deepseek/deepseek-v4-pro` | ❌ | 200 000 / 1 048 576 | — |
| `glm-5` | `z-ai/glm-5` | ❌ | 202 752 | — |
| `glm-5.1` | `z-ai/glm-5.1` | ❌ | 202 752 | — |
| `kimi-k2.6` | `moonshotai/kimi-k2.6` | ✅ | 262 144 | — |
| `gemma-4-31b` | `google/gemma-4-31b-it` | ✅ | 262 144 | — |
| `qwen3.5-397b-a17b` | `qwen/qwen3.5-397b-a17b` | ✅ | 262 144 | — |
| `grok-4.3` | `x-ai/grok-4.3` | ✅ | 200 000 / 1 000 000 | 🔒 ZDR |
| `grok-4.20` | `x-ai/grok-4.20` | ✅ | 200 000 / 2 000 000 | 🔒 ZDR |
| `claude-sonnet-5` | `anthropic/claude-sonnet-5` | ✅ | 200 000 / 1 000 000 | — 🚫 |

The two Grok offerings (added 2026-06-28) are the **ZDR route for Grok** — xAI
itself offers no ZDR on its direct API today. See [[../models/grok-4.3]] and
[[../models/grok-4.20]].

`recommended ≠ max` for DeepSeek V4: OpenRouter reports a 1 048 576 ceiling, but
recommended stays at our 200 000 DeepSeek-V4 sweet-spot (matching the wafer
offerings — where the model stays smart).

## Claude Sonnet 5 — the first Claude on OpenRouter (added 2026-06-30)

Sonnet 5 is the one Claude offering **not** on nano-gpt (Chris's call — it went
live on OpenRouter and the user owns the upstream route there). It carries the
loud 🚫 **CENSORED** badge (`canonical.freedomOriented: false`) and **no ZDR**
(the honest US-router posture; unlike Grok we do not send `provider:{zdr:true}`).
Full per-model detail in [[../models/claude-5]]. Three OpenRouter-specific
findings, all probed live 2026-06-30 (key routed to Google Vertex):

- **Reasoning is a `steps` control, not the uniform toggle.** Effort genuinely
  modulates Sonnet 5's trace (`low` ≈ 17 reasoning tokens, `high` ≈ 270), so the
  offering is `steps` `['off','low','medium','high']` (default `medium`),
  mirroring the Fable family. We do **not** expose OpenRouter's full effort
  surface (`xhigh`/`max`) — calm cockpit, family consistency. This is the only
  OpenRouter offering whose reasoning is not a plain toggle.

- **Strict system-message ordering.** OpenRouter rejects a `system` message that
  sits after an assistant turn for Anthropic models: **HTTP 400** — `messages.5:
  role 'system' must precede an 'assistant' message or end the array`. The other
  targets (DeepSeek/GLM) tolerate a mid-conversation system message; Anthropic
  does not, and OpenRouter does not hoist it (nano-gpt does, implicitly). The
  `claudeOpenRouterAdapter` therefore **merges all `system` messages into one
  leading message** before caching — a no-op for the common shape. Production is
  unaffected regardless (memory lives in the leading system message); the hoist
  keeps the offering robust and the conversation-suite green.

- **Caching engages, read-back is route-dependent.** `cache_control` is accepted
  (no 400) and triggers a cache write (`cache_write_tokens` > 0), but a read-back
  was not observed on an immediate repeat — the aggregator load-balances across
  regional endpoints with no shared cache. The saving lands only where routing is
  sticky (e.g. an Anthropic-direct route on the user's key); the injection is
  harmless elsewhere, so it is always emitted. This is exactly the
  *guaranteed*-caching gap ADR 0032 cites for keeping the Claude family on
  nano-gpt — Sonnet 5 is the deliberate, user-route-owned exception.

## MiMo exclusion (explicit)

The two MiMo canonicals (`mimo-v2.5-omni`, `mimo-v2.5-pro`) are **deliberately
NOT offered on OpenRouter.** OpenRouter routes MiMo only via **Xiaomi** with its
built-in censorship, and Chatsundere will not surface a censored route
(anti-censorship stance). Chris's explicit call (2026-05-31). This is not a
"could not route" — it is a values decision to exclude.

## Mistral flagships — investigated, NOT curated via OpenRouter

The three Mistral flagships exist on OpenRouter `/models`, but live probing
(2026-05-31) showed they are **not reliably routable** for our key, so they are
deliberately **not offered** here. Mistral is already covered reliably by the
direct Mistral provider (CORS-direct) and via nano-gpt — the OpenRouter route
adds only breakage.

Probed against `chat/completions` with `keys/.or-test-key`:

| Slug | Result | Why |
|---|---|---|
| `mistralai/mistral-small-2603` | **429** | rate-limited on the free route (Venice); flaps to 404 when no compliant endpoint is free |
| `mistralai/mistral-medium-3-5` | **404** | "No endpoints available matching your guardrail restrictions and data policy" |
| `mistralai/mistral-large-2512` | **404** | same data-policy gate (also reports no `reasoning` param — consistent with the `mistral-large-3` canonical) |

The 404 is an **account-level OpenRouter setting**, not a code fault: a
privacy-oriented data/guardrail policy filters out the few (proprietary-Mistral)
providers serving Medium/Large. **Most of our users run privacy-oriented keys —
that is the audience** — so they could not route these even if we offered them,
and an offering that 404s for most users is worse than none. Same class of
decision as DeepSeek V4 Flash's exclusion: a well-evidenced negative finding.

**General heads-up (applies to every OpenRouter offering):** OpenRouter routing
is account-dependent — a user's privacy/data-policy can filter endpoints, so a
model that routes for one key may 404 for another. The 8 curated offerings above
are open-weight models with many compliant providers, so they pass a
privacy-oriented policy; proprietary models with few providers may not.

## Validation (live conversation-suite, 2026-05-31)

Run serially, one offering at a time, via `curation/run-openrouter-suite.ts`
(`makeLiveBinding`, `keys/.or-test-key`, direct routing). Full report:

| Offering | core | vision | notes |
|---|---|---|---|
| `deepseek/deepseek-v3.2` | **PASS 22/22** | — | |
| `deepseek/deepseek-v4-flash` | **PASS 22/22** | — | |
| `deepseek/deepseek-v4-pro` | **PASS 22/22** | — | |
| `z-ai/glm-5` | **PASS 22/22** | — | |
| `z-ai/glm-5.1` | **PASS 22/22** | — | off genuinely silent (toggle confirmed) |
| `moonshotai/kimi-k2.6` | **PASS 22/22** | **PASS 4/4** | green described |
| `google/gemma-4-31b-it` | **PASS 22/22** | **PASS 4/4** | first vision run hit a transient 429; retried green |
| `qwen/qwen3.5-397b-a17b` | **PASS 22/22** | **PASS 4/4** | green described |

Every offering: no HTTP/stream error, tool fires with valid JSON args, usage
normalised (`totalTokens > 0`), reasoning present/absent on the correct channel
per permutation, memory carried through. Vision offerings additionally carry the
image through and name the clothing colour.

## Sort priority

`sortPriority: 45` — last, in the router tier alongside nano-gpt (40), because
OpenRouter is a US aggregator with no default ZDR/TEE. 45 (not the subagent's
provisional 30) avoids a tie with ollama-cloud (30) that would make the
provider-list order non-deterministic. Chris approved "below the privacy tier"
(2026-05-31); this honours that without the tie.
