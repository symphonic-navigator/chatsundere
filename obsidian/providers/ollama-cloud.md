# Provider — Ollama Cloud

> Curation Record. Live-verified 2026-07-17 via `run-ollama-suite.ts` — all three
> LLM offerings green across `core`, `one-shot` and `sampling-cap`.
> Previously "live-verified 2026-06-03"; that claim was true and simultaneously
> concealed three broken background jobs. See "What was repaired" below.

- **id:** `ollama-cloud` · **baseUrl:** `https://ollama.com` (bare host) · **probe:** `/v1/models`
- **Wire:** ollama's **native `/api/chat` (NDJSON)** via `ollamaNativeAdapter` — **not** the OpenAI-compat `/v1/chat/completions` shim (see "Why native" below)
- **CORS:** `requires-proxy` (ollama.com answers no ACAO → the browser routes through the user's CORS proxy; Bun/Node verification is direct)
- **Key:** `keys/.ollama-test-key` (never in CI)
- **Adapter:** catalogue (`ollama-cloud:<slug>`), `responseFraming: 'ndjson'`

## Curated offerings (3)

| Canonical | Slug | Reasoning | Vision | Tools | ctx | Confidence |
|---|---|---|---|---|---|---|
| glm-5.1 | `glm-5.1` | fixed-on | no | yes | 200k | verified |
| glm-5.2 | `glm-5.2:cloud` | fixed-on | no | yes | 200k (max 1M) | verified |
| deepseek-v4-pro | `deepseek-v4-pro` | fixed-on | no | yes | 200k | verified |

Live conversation-suite 2026-07-17, **all three green on all three scenarios**:
`core` (11 checks), `one-shot` (2), `sampling-cap` (3). The background-job path
returns real titles (24 / 23 / 23 chars) and the token cap now reaches the wire
(16 completion tokens against a 16 cap, on each).

## Why native `/api/chat`, not `/v1/chat/completions`

**The original justification no longer holds, and is not the reason any more.**

It used to read: with a realistic system prompt, ollama's `/v1` shim mishandles the
multi-turn tool replay for reasoning-native models — after a tool result they
re-call the tool instead of answering, churning to the 5-round cap (measured
2026-06-03). **Re-measured 2026-07-17: that does not reproduce.** With the real
`buildPrompt` system prompt (3 859 chars, tonality + tools segment), streaming, 3
runs per cell, `/v1` answered after the tool result **18/18** — across `glm-5.1`
(the model the original finding named), `glm-5.2:cloud` and `deepseek-v4-pro`, on
both `generate_image` and `calculate_js`. Native scored 18/18 too. Either ollama
fixed the shim, or the original cause lay elsewhere; the original prompt was not
preserved, so this refutes the *stated* justification without proving it was never
real.

Native is nonetheless kept, on reasons that stand on their own:

- It is ollama's **first-class API**; `/v1` is a compatibility shim, and this
  record itself documents that shim breaking once.
- **Tool-call arguments arrive atomically** in one chunk, so there is no SSE
  fragment reassembly to get wrong — an area the `/curate` checklist flags as
  error-prone.
- A dedicated `message.thinking` reasoning channel.
- It is **smaller**: `ollama-native.ts` is 160 lines, the smallest adapter in the
  repo. There is no reusable OpenAI adapter base — chutes 175, wafer 190, tensorix
  187, mistral 238, openrouter 264, xai 267 lines, each reimplementing the same SSE
  parse. A `/v1` adapter for ollama would be a **seventh** clone of it: net *more*
  code, not less.

`/v1` is therefore a **measured-viable fallback**, not a broken path. Recorded so a
future decision needs no re-probing: it serves the OpenAI envelope, honours
`temperature` and `max_tokens` directly, streams reasoning as `delta.reasoning`,
and disables reasoning via `reasoning_effort: 'none'` (which halves completion
tokens, 481 → 222). Note `think` is **ignored** on `/v1`; `reasoning_effort` is the
lever there.

The related native detail: on `/api/chat` the assistant tool-call replay uses
native shape (`tool_calls[].function.arguments` as an **object**, `images` as raw
base64). Sending the OpenAI JSON-string form there is an error — worth knowing, as
it silently produced an HTTP failure during the 2026-07-17 re-measurement until the
probe was corrected.

## What the native adapter does (`src/adapters/ollama-native.ts`)

- **`buildRequest`** → `path: '/api/chat'`, native body: `{ model, messages (native
  translation), stream:true, think:<reasoning.enabled>, tools }`.
- **`parseChunk`** over NDJSON chunks: `message.content` → token, `message.thinking`
  → reasoning, `message.tool_calls` → tool-call (atomic — args already an object),
  `done:true` → usage (`prompt_eval_count`/`eval_count`) + finish.
- **`responseFraming: 'ndjson'`**.

## Framework extension (general, reusable)

To let a non-OpenAI provider plug in, the adapter contract gained two optional
hooks, both honoured by `streamCompletion` AND the suite binding:
- `WireRequest.path` — the endpoint path (default `/chat/completions`).
- `ModelAdapter.responseFraming: 'sse' | 'ndjson'` — picks `parseWithAdapter`
  (SSE) vs the new `parseWithAdapterNdjson` (one JSON object per line).

This resolves the `verified ↔ catalogue` invariant cleanly: ollama is now a real
catalogue adapter, no relax needed.

## What was repaired (Mode 3, 2026-07-17) — background jobs

Reported as "GLM 5.2's background workers don't work on ollama". It was **not a
GLM 5.2 problem**: title generation, memory extraction and compaction were broken
for **every** ollama model, and had been since onboarding. Chatting was unaffected.
Three faults, one class — **an OpenAI-shaped assumption hard-wired outside the
adapter**:

1. **The adapter's endpoint path was discarded.** `runOneShotCompletion` composed
   its own wire and hard-coded `/chat/completions`. Our `baseUrl` is the bare host,
   so every background job requested `https://ollama.com/chat/completions` → **HTTP
   404**, measured for all three slugs. 404 is not retryable, so the job failed
   instantly and silently (fallback title, no hang).
2. **The reply was parsed as an OpenAI envelope** (`json.choices[0].message.content`),
   which `/api/chat` never sends. Fixing only the path would have traded the 404
   for an "empty content" error.
3. **Sampling never reached the adapter.** `temperature` and `max_tokens` were
   spread as top-level keys, where ollama ignores them silently. So **ollama had no
   working temperature control and no working token cap — on the chat path too.**

The fix deletes the parallel wire path: `runOneShotCompletion` is now a fold over
`streamCompletion`, so background jobs inherit every adapter hook by construction.
An optional `mapSampling` hook lets the adapter nest sampling under `options`.

### Evidence (live, local, never CI)

| Probe | Result |
|---|---|
| top-level `max_tokens: 8` | `eval_count: 120` — **ignored** |
| `options: { num_predict: 8 }` | `eval_count: 8` — **honoured exactly** |
| `options: { temperature: 5 }` | **HTTP 400** — "temperature must be between 0.0 and 2.0" |
| top-level `temperature: 5` | **HTTP 200**, coherent output |

The last pair is the decisive one: the server **validates** what it reads, and
accepts an impossible top-level value without complaint because nothing looks at
it. Ollama's docs agree — the `options` fields "must be nested under `options`, not
at the top level". The schema is `seed`, `temperature`, `top_k`, `top_p`, `min_p`,
`stop`, `num_ctx`, `num_predict`. We map `temperature`, `max_tokens` → `num_predict`,
`top_p`, `seed`, `stop`. `top_k`/`min_p` are deliberately unmapped (no OpenAI-side
equivalent we send; Chris's call, contested in review). **`num_ctx` is deliberately
not sent**: a needle-at-position-0 probe found no truncation at 1 722 / 8 442 /
25 242 evaluated prompt tokens.

### Why the suite never caught it

The harness had **its own** wire composition (`binding.ts` does its own fetch, so a
non-2xx becomes a checkable outcome). It honoured `wire.path` **correctly** — it was
*more correct than the production code it verifies*, so it could not reproduce the
404, and it never touched `runOneShotCompletion` at all. It also sent **no sampling
whatsoever**, so an ignored cap could not surface. **A verification harness that
rebuilds its subject cannot fail the way its subject fails.**

Closed by: sharing the production composer (`composeWire`) with the binding; a
`sampling-cap` scenario asserting `usage-within-cap`; and a `one-shot` scenario that
drives the background-job entry point. A registration gap was found while wiring it —
`run-ollama-suite.ts` never called `registerOllamaCloud()`, so `getAdapter` would
have resolved nothing and the new turn would have silently proven nothing.

## What was repaired (Mode 3, 2026-06-03) — the offering set

Provider was `confidence: heuristic`, never live-verified, with a set that did not
survive contact with ollama.com:
- **Three slugs do not exist** on ollama.com → removed (`glm-5`,
  `deepseek-v4-flash`, `kimi-k2.6`).
- **`gemma4:31b` dropped** — ollama serves a non-reasoning Gemma, which cannot
  satisfy the reasoning-required `gemma-4-31b` canonical.
- **Reasoning corrected** — `think:false` is a no-op on these models → fixed-on.
  **Superseded 2026-07-17:** natively, `think: false` yields clean content and an
  **empty** thinking channel — it genuinely disables reasoning. The claim in
  `ollama-cloud.ts:67` that it "still streams reasoning (leaks into content)" for
  GLM 5.2 does not reproduce on `/api/chat`; it most likely dates from the `/v1`
  shim era, where `think` *is* ignored. **This means the `fixed-on` classification
  is probably wrong on both endpoints** (`/v1` disables via
  `reasoning_effort: 'none'`). That is UX-visible — a toggle may be owed to the
  user — so it is Chris's call and is tracked as a follow-up, not changed here.

## Web interfacing (search + fetch)

> Live-verified 2026-06-03 via `run-ollama-web-suite.ts` — **4/4** (search
> standard/quick/deep = 5/3/10 hits, confirming the `max_results` mapping;
> fetch = 940 chars).

Ollama Cloud also serves web search and fetch — ported from chatsune's backend,
the same `ollama-cloud` API key covers both LLM (`/api/chat`) and web.

- **Endpoints:** `POST https://ollama.com/api/web_search` (`{ query, max_results }`,
  1–10) and `POST https://ollama.com/api/web_fetch` (`{ url }`). Auth
  `Authorization: Bearer <key>`. Responses `{ results: [{ title, url, snippet|content }] }`
  and `{ content, title }`.
- **CORS:** `requires-proxy` — ollama.com sends no ACAO, so the browser routes
  through the user's CORS proxy; the Bun live-suite goes direct.
- **Adapter:** `src/web-adapters/ollama-web.ts` (`ollamaWebSearchAdapter`,
  `ollamaWebFetchAdapter`), mirroring `nano-gpt-web.ts`. The tier param
  `numResults` is translated to Ollama's `max_results` (clamped 1–10).

### Offerings (2, separate per role — mirrors nano-gpt)

| Slug | Role | Traits | Tiers (numResults) |
|---|---|---|---|
| `web-ollama-search` | search | `ai` | standard 5 (default), quick 3, deep 10 |
| `web-ollama-fetch` | fetch | — | — |

Tiers are listed **recommended-first** (`standard` before `quick`) so the no-pick
default (`tiers[0]`) is the 5-result standard, not the cheapest.

## Open / follow-ups

- `freedomOrientedDeployment: null` — pending Chris (ollama is open-weight / self-hostable infra).
- **`run-ollama-suite.ts` iterates ALL offerings**, including the two web ones, and
  builds an LLM adapter for `web-ollama-search` / `web-ollama-fetch`. Both
  consequently report FAIL (HTTP 404) on every scenario in a live run — noise, not
  signal. Pre-existing; not fixed in the 2026-07-17 pass. The file's header comment
  is stale too: it claims ollama uses the generic path via `makeGenericLiveBinding`,
  while the code uses `makeLiveBinding` with the native adapter.
- **GLM 5.2 `fixed-on` is probably wrong** — see the `think:false` correction above.
  Needs a probe across permutations, then Chris's judgement.
- **`/v1` is a measured-viable fallback** (18/18 tool replay, reasoning, sampling).
  The native adapter's stated justification is gone; the remaining reasons are
  first-class API, atomic tool args and smaller code. Revisit deliberately if a
  shared `openAiCompatAdapter` for the six near-duplicate OpenAI adapters is ever
  built — that would make `/v1` nearly free.
- **Suite gap (noted):** the core scenario asserts a tool *fires*, not that the
  model *answers* after the tool result — which is why the `/v1` re-search slipped
  through ("validate the pipe, never the intelligence"). Worth adding a
  post-tool-result answer assertion so this class is caught in-suite, not on device.
