# Provider — Ollama Cloud

> Curation Record. Live-verified 2026-06-03 via `run-ollama-suite.ts`.

- **id:** `ollama-cloud` · **baseUrl:** `https://ollama.com` (bare host) · **probe:** `/v1/models`
- **Wire:** ollama's **native `/api/chat` (NDJSON)** via `ollamaNativeAdapter` — **not** the OpenAI-compat `/v1/chat/completions` shim (see "Why native" below)
- **CORS:** `requires-proxy` (ollama.com answers no ACAO → the browser routes through the user's CORS proxy; Bun/Node verification is direct)
- **Key:** `keys/.ollama-test-key` (never in CI)
- **Adapter:** catalogue (`ollama-cloud:<slug>`), `responseFraming: 'ndjson'`

## Curated offerings (2)

| Canonical | Slug | Reasoning | Vision | Tools | ctx | Confidence |
|---|---|---|---|---|---|---|
| glm-5.1 | `glm-5.1` | fixed-on | no | yes | 200k | verified |
| deepseek-v4-pro | `deepseek-v4-pro` | fixed-on | no | yes | 200k | verified |

Live conversation-suite: both **core 11/11**. End-to-end through the real client
path (`streamCompletion` → native adapter → `/api/chat`), glm-5.1 answers after a
tool result (2247 answer chars, 0 re-search).

## Why native `/api/chat`, not `/v1/chat/completions`

This is the load-bearing finding. With a realistic system prompt (tonality +
multi-tool segment), ollama's OpenAI-compat **`/v1` shim mishandles the multi-turn
tool replay** for reasoning-native models: after a tool result they **re-call the
tool instead of answering** (glm-5.1 churns to the 5-round cap → the user sees only
"one moment"). The **native `/api/chat` endpoint answers correctly** with the same
prompt — measured A/B 2026-06-03, and the path chatsune uses in production.

Root cause is the endpoint/format, not the model: on `/api/chat` the assistant
tool-call replay uses native shape (`tool_calls[].function.arguments` as an object,
`images` as raw base64), and the model continues to a final answer.

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

## What was repaired (Mode 3)

Provider was `confidence: heuristic`, never live-verified, with a set that did not
survive contact with ollama.com:
- **Three slugs do not exist** on ollama.com → removed (`glm-5`,
  `deepseek-v4-flash`, `kimi-k2.6`).
- **`gemma4:31b` dropped** — ollama serves a non-reasoning Gemma, which cannot
  satisfy the reasoning-required `gemma-4-31b` canonical.
- **Reasoning corrected** — `think:false` is a no-op on these models → fixed-on.

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
- **Suite gap (noted):** the core scenario asserts a tool *fires*, not that the
  model *answers* after the tool result — which is why the `/v1` re-search slipped
  through ("validate the pipe, never the intelligence"). Worth adding a
  post-tool-result answer assertion so this class is caught in-suite, not on device.
