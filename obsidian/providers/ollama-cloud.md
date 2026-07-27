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

## Curated offerings (4)

| Canonical | Slug | Reasoning | Vision | Tools | ctx | Confidence |
|---|---|---|---|---|---|---|
| glm-5.1 | `glm-5.1` | **toggle** (default on) | no | yes | 200k | verified |
| glm-5.2 | `glm-5.2:cloud` | **steps** (off/on/max, default on) | no | yes | 200k (max 1M) | verified |
| deepseek-v4-pro | `deepseek-v4-pro` | **toggle** (default on) | no | yes | 200k | verified |
| kimi-k3 | `kimi-k3:cloud` | **fixed-on** (by policy — see below) | **yes** | yes | 262k (max 1M) | verified |

Reasoning steerability is **per model here, not a provider trait** — see the
`think:false` table below.

## Kimi K3 (2026-07-27) — two provider traits worth knowing

Onboarded the day Moonshot's open weights dropped; ollama served it within the
hour. Full measurements in [[../models/kimi-k3]]; two findings belong to the
provider rather than the model.

1. **Extra-usage gating has its own error shape.** K3 is served as *"extra usage
   only"* (Pro/Max subscription, tier "Extra High Usage"). With an empty
   balance every request answers HTTP 200 with
   `{"error":"this model uses extra usage only … your extra usage balance is
   empty, add extra usage or turn on auto reload"}` — **not** a 401 or a 404. It
   is easy to misread as a bad key or a wrong slug; it is a billing state.
2. **Token counts can be missing per model.** K3 reports **no**
   `prompt_eval_count` / `eval_count` at all, streaming or not, while glm-5.1,
   glm-5.2, deepseek-v4-pro and **kimi-k2.6** all report them on the same key on
   the same day. The `/v1` shim fabricates `{prompt_tokens: 0,
   completion_tokens: 0, total_tokens: 0}` rather than omitting the object,
   which is the worse failure: an absence dressed as a measurement. Any
   assertion or feature that reads `usage` must therefore treat it as optional
   **per offering**, not per provider. The sampling cap still had to be proven —
   `done_reason` is the substitute witness (`length` at `num_predict: 16`,
   `stop` without a cap and `stop` for the ignored top-level `max_tokens`).

`run-ollama-suite.ts` now takes an optional argv[2] substring filter (e.g.
`bun run curation/run-ollama-suite.ts kimi`), mirroring the OpenRouter runner —
verifying one new offering no longer re-runs every curated model.

## `think` became a level (2026-07-26)

Ollama's compute build-out came with a wire-semantics change that **no
release note announced and that our code could not detect**: `think` is no
longer a boolean but a validated enum. The server states its own contract when
you break it:

```
HTTP 400  invalid think value: "banana"
          (must be "high", "medium", "low", "max", true, or false)
```

Two consequences, both live-measured 2026-07-26:

1. **`think:false` became meaningful on GLM 5.2.** It previously only relocated
   the reasoning into the answer; it now empties the thinking channel in 8/8
   runs. Since a `fixed-on` control makes the cockpit emit no intent — and
   `composeWire` then defaults to `{enabled:false}` — we had been sending
   `think:false` on every GLM 5.2 request all along. The day the byte changed
   meaning, reasoning disappeared in the field. **Our code never changed.**
   Full measurement table and the repair: [[../models/glm-5.2]].
2. **`max` is a real level above `high`** — on GLM 5.2. Measured n=4 × 2
   prompts: `max` separates cleanly (+47% / +170% thinking chars), while
   `low`/`medium`/`high` do not separate at all from one another. GLM 5.2 is
   therefore curated as `off / on / max`: every rung the probes can defend, and
   no rung they cannot. Offering ollama's full level set would promise a
   steerability we measured and did not find.

Checked on the other two curated models in the same sweep (n=2 × 2 prompts):
**glm-5.1 shows no `max` effect** (1493 vs 1536 chars for plain `true` on P1;
all four levels within noise on both prompts) and **deepseek-v4-pro only a weak,
single-prompt hint** (P2 max 2042 vs ≈700–1200, nothing on P1). Neither is
reclassified — both keep `toggle`, and both still have a genuine off
(`think:false` → 0 thinking chars, 4/4 runs each). Re-measure with a larger n
before offering either a ladder.

**The standing lesson:** a provider can change the meaning of a request you have
been sending unchanged for weeks. Nothing in our repo could have caught this —
no test, no type, no review. Only a live probe against the real endpoint does,
which is why the curation harness exists (CLAUDE.md §13, "empirical truth over
docs").

**Catalogue also grew.** `/v1/models` on 2026-07-26 lists 18 models, including
three that were removed in 2026-06 as non-existent (`deepseek-v4-flash`,
`kimi-k2.6`, `gemma4:31b`) and several new ones (`minimax-m3`, `minimax-m2.7`,
`nemotron-3-ultra`, `nemotron-3-super`, `qwen3.5:397b`, `mistral-large-3:675b`,
`kimi-k2.7-code`, `gpt-oss:20b|120b`). None onboarded — no Krämerladen; onboard
on request, per model. Also noted: bare **`glm-5.2` now resolves** and
`/api/show` reports it identical to `glm-5.2:cloud`, so the `:cloud` suffix is no
longer load-bearing (we keep it; it never broke).

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
  **Refined 2026-07-17 — it is per-model, and the blanket "no-op" was wrong in
  both directions:**

  Broad probe, **n=5 per cell × 2 reasoning-warranting prompts** (medians):

  | Model | `think:false` → eval_count | content | Classification |
  |---|---|---|---|
  | `glm-5.1` | 777 → **269** (−65%) · 842 → **234** (−72%) | unchanged (831→802, 786→838) | **`toggle`** — a real off-switch |
  | `deepseek-v4-pro` | 343 → **170** (−50%) · 464 → **185** (−60%) | ~stable | **`toggle`** — a real off-switch |
  | `glm-5.2:cloud` | 563 → **1055** (+87%) · 712 → 526 (−26%) | **3-4x longer** (735→3208, 497→1555) | **`fixed-on`** — NOT an off-switch *(superseded 2026-07-26 → `steps`, see above)* |

  Thinking channel empties on all three; `done_reason: stop`, no truncation
  anywhere. **The discriminator is content length, not `eval_count`** — GLM 5.2's
  eval_count also fell on one prompt (−26%), which alone reads as an off-switch. It
  is not: the reasoning simply moves into the answer, so "off" buys a longer,
  chattier reply rather than a cheaper one. That is exactly the `fixed-on` /
  "off only hides" case, and a toggle there would astonish the user. GLM 5.2 is the
  one model where the original "leaks into content" instinct holds.

  The other two contradict the 2026-06-03 "think:false is a no-op on these models"
  line, and are now `{ mode: 'toggle', defaultOn: true }` — on by default because
  reasoning is the reason to pick a reasoning-native model, and quality degrades
  without it. **The live suite now verifies this itself**: a `toggle` yields two
  permutations, and `reasoning-absent` / `reasoning-present` both PASS on each.

  > **A correction worth keeping visible.** An earlier note in this same 2026-07-17
  > pass claimed `think:false` disables reasoning on GLM 5.2 and that `fixed-on`
  > was therefore probably wrong. **That was a bad experiment, not a bad
  > provider:** it probed with a *title* prompt ("Reply with a short chat title
  > only"), which never triggers reasoning at all, so the short clean answer proved
  > nothing. Re-probed with a prompt that genuinely warrants reasoning, the
  > opposite shows. The claim was propagated into the spec, this record and the
  > follow-ups index before it was caught.

  Reclassifying `glm-5.1` / `deepseek-v4-pro` to `toggle` is UX-visible and is
  Chris's call — tracked as a follow-up, not changed here.

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
- ~~**`run-ollama-suite.ts` iterates ALL offerings**, including the two web ones,
  which report FAIL (HTTP 404) as noise; header comment stale too~~ — **both
  resolved.** Verified 2026-07-27: the runner filters `serviceKind === 'llm'`, so
  the web offerings are never driven through the chat suite, and the header
  comment describes `makeLiveBinding` with the native adapter, which is what the
  code does. The bullet outlived its defect.
- **`usage` is optional per offering, not per provider** (Kimi K3 reports none).
  Anything downstream that will read token counts — the usage-display slice
  above all — needs a "this model reports nothing" state rather than a zero.
- ~~`glm-5.1` / `deepseek-v4-pro` `fixed-on` is probably wrong~~ — **Resolved
  2026-07-17.** Both are now `{ mode: 'toggle', defaultOn: true }`; GLM 5.2 was
  kept `fixed-on` — **and that is what broke it five weeks later**, when ollama
  turned `think:false` into a genuine off. It is now `steps`
  (off/low/medium/high/max); see *"`think` became a level"* above.
- **`/v1` is a measured-viable fallback** (18/18 tool replay, reasoning, sampling).
  The native adapter's stated justification is gone; the remaining reasons are
  first-class API, atomic tool args and smaller code. Revisit deliberately if a
  shared `openAiCompatAdapter` for the six near-duplicate OpenAI adapters is ever
  built — that would make `/v1` nearly free.
- **Suite gap (noted):** the core scenario asserts a tool *fires*, not that the
  model *answers* after the tool result — which is why the `/v1` re-search slipped
  through ("validate the pipe, never the intelligence"). Worth adding a
  post-tool-result answer assertion so this class is caught in-suite, not on device.
